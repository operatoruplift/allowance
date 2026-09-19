import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { Ledger } from '../policy/ledger.js';

export const AGENT_GRANT_SCOPES = [
  'wallet_snapshot',
  'transaction_explain',
  'get_run_status',
  'get_receipt',
  'stop_run',
] as const;
export type AgentGrantScope = (typeof AGENT_GRANT_SCOPES)[number];

export class AgentGrantError extends Error {
  constructor(
    public code: 'GRANT_INVALID' | 'GRANT_EXPIRED' | 'GRANT_REVOKED' | 'GRANT_SCOPE_DENIED',
    message: string
  ) {
    super(message);
  }
}

export interface AgentGrant {
  id: string;
  runId: string;
  owner: string;
  sessionId: string;
  scopes: AgentGrantScope[];
  expiresAt: string;
  revokedAt: string | null;
}

interface GrantRow {
  id: string;
  token_hash: string;
  run_id: string;
  owner: string;
  session_id: string;
  scopes: string;
  expires_at: number;
  created_at: string;
  revoked_at: number | null;
  last_used_at: number | null;
}

function hashToken(token: string) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function assertGrantSession(
  db: Database.Database,
  sessionId: string,
  owner: string,
  now = Date.now()
) {
  const row = db.prepare('SELECT expires,data FROM sessions WHERE sid=?').get(sessionId) as
    { expires: number; data: string } | undefined;
  if (!row || row.expires <= now)
    throw new AgentGrantError('GRANT_EXPIRED', 'The authorizing session is no longer active.');
  let session: { operator?: unknown; issuedAt?: unknown };
  try {
    session = JSON.parse(row.data) as typeof session;
  } catch {
    throw new AgentGrantError('GRANT_INVALID', 'The authorizing session is invalid.');
  }
  if (
    !session ||
    session.operator !== owner ||
    typeof session.issuedAt !== 'number' ||
    !Number.isSafeInteger(session.issuedAt) ||
    session.issuedAt > now ||
    now - session.issuedAt >= 8 * 60 * 60 * 1000
  )
    throw new AgentGrantError('GRANT_EXPIRED', 'The authorizing session is no longer active.');
}

/** Called again inside the durable signing claim, after any asynchronous payment work. */
export function assertExternalRunAuthorization(
  db: Database.Database,
  runId: string,
  owner: string,
  scope: AgentGrantScope,
  now = Date.now()
) {
  const rows = db.prepare('SELECT * FROM agent_grants WHERE run_id=?').all(runId) as GrantRow[];
  // One human grant is the durable authority for one run. Legacy ambiguity fails closed.
  const row = rows.length === 1 ? rows[0] : undefined;
  if (
    row &&
    row.owner === owner &&
    row.revoked_at === null &&
    row.expires_at > now &&
    parseScopes(row.scopes).includes(scope)
  ) {
    try {
      assertGrantSession(db, row.session_id, owner, now);
      return;
    } catch (error) {
      if (!(error instanceof AgentGrantError)) throw error;
    }
  }
  throw new AgentGrantError(
    'GRANT_INVALID',
    'No active human authorization permits this external purchase.'
  );
}

function parseScopes(raw: string): AgentGrantScope[] {
  const value: unknown = JSON.parse(raw);
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((scope) => !AGENT_GRANT_SCOPES.includes(scope as AgentGrantScope))
  )
    throw new Error('Stored agent grant scopes are invalid.');
  return [...new Set(value)] as AgentGrantScope[];
}

function toGrant(row: GrantRow): AgentGrant {
  return {
    id: row.id,
    runId: row.run_id,
    owner: row.owner,
    sessionId: row.session_id,
    scopes: parseScopes(row.scopes),
    expiresAt: new Date(row.expires_at).toISOString(),
    revokedAt: row.revoked_at === null ? null : new Date(row.revoked_at).toISOString(),
  };
}

export function createAgentGrant(
  db: Database.Database,
  ledger: Ledger,
  options: {
    runId: string;
    owner: string;
    sessionId: string;
    expiresAt: string;
    scopes?: AgentGrantScope[];
  }
) {
  const run = ledger.getRun(options.runId, options.owner);
  if (run.executionMode !== 'external') throw new Error('Run is not an external-agent run.');
  if (run.status !== 'running' && run.status !== 'queued')
    throw new Error('Run is no longer available for an external agent.');
  const expiresAt = Date.parse(options.expiresAt);
  if (
    !Number.isSafeInteger(expiresAt) ||
    expiresAt <= Date.now() ||
    expiresAt > Date.parse(run.policy.expiresAt)
  )
    throw new Error('Agent grant expiry is invalid or already elapsed.');
  assertGrantSession(db, options.sessionId, options.owner);
  const scopes = [...new Set(options.scopes ?? AGENT_GRANT_SCOPES)];
  if (scopes.length === 0 || scopes.some((scope) => !AGENT_GRANT_SCOPES.includes(scope)))
    throw new Error('Agent grant scope is invalid.');
  const id = randomBytes(16).toString('hex');
  const token = randomBytes(32).toString('base64url');
  const createdAt = new Date().toISOString();
  db.transaction(() => {
    if (db.prepare('SELECT 1 FROM agent_grants WHERE run_id=? LIMIT 1').get(options.runId))
      throw new AgentGrantError(
        'GRANT_INVALID',
        'This run already has its one human grant. Authorize a new run instead.'
      );
    db.prepare(
      'INSERT INTO agent_grants(id,token_hash,run_id,owner,session_id,scopes,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?)'
    ).run(
      id,
      hashToken(token),
      options.runId,
      options.owner,
      options.sessionId,
      JSON.stringify(scopes),
      expiresAt,
      createdAt
    );
  }).immediate();
  return {
    grant: {
      id,
      runId: options.runId,
      owner: options.owner,
      sessionId: options.sessionId,
      scopes,
      expiresAt: new Date(expiresAt).toISOString(),
      revokedAt: null,
    },
    token,
  };
}

export function authorizeAgentGrant(
  db: Database.Database,
  token: string,
  runId: string,
  scope: AgentGrantScope
): AgentGrant {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token))
    throw new AgentGrantError('GRANT_INVALID', 'Agent grant is invalid.');
  const row = db.prepare('SELECT * FROM agent_grants WHERE token_hash=?').get(hashToken(token)) as
    GrantRow | undefined;
  if (!row) throw new AgentGrantError('GRANT_INVALID', 'Agent grant is invalid.');
  const expected = Buffer.from(row.token_hash, 'hex');
  const actual = Buffer.from(hashToken(token), 'hex');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
    throw new AgentGrantError('GRANT_INVALID', 'Agent grant is invalid.');
  if (row.run_id !== runId) throw new AgentGrantError('GRANT_INVALID', 'Agent grant is invalid.');
  if (row.revoked_at !== null)
    throw new AgentGrantError('GRANT_REVOKED', 'Agent grant is revoked.');
  if (row.expires_at <= Date.now())
    throw new AgentGrantError('GRANT_EXPIRED', 'Agent grant is expired.');
  assertGrantSession(db, row.session_id, row.owner);
  const run = db.prepare('SELECT owner FROM runs WHERE id=?').get(runId) as
    { owner: string } | undefined;
  if (!run || run.owner !== row.owner)
    throw new AgentGrantError('GRANT_INVALID', 'Agent grant is invalid.');
  const grant = toGrant(row);
  if (!grant.scopes.includes(scope))
    throw new AgentGrantError('GRANT_SCOPE_DENIED', 'Agent grant does not allow this tool.');
  db.prepare('UPDATE agent_grants SET last_used_at=? WHERE id=?').run(Date.now(), row.id);
  return grant;
}

export function revokeAgentGrant(db: Database.Database, runId: string, owner: string) {
  db.prepare(
    'UPDATE agent_grants SET revoked_at=COALESCE(revoked_at,?) WHERE run_id=? AND owner=?'
  ).run(Date.now(), runId, owner);
}

export function revokeSessionAgentGrants(db: Database.Database, sessionId: string) {
  if (sessionId)
    db.prepare('UPDATE agent_grants SET revoked_at=COALESCE(revoked_at,?) WHERE session_id=?').run(
      Date.now(),
      sessionId
    );
}
