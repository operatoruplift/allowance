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
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now())
    throw new Error('Agent grant expiry is invalid or already elapsed.');
  const scopes = [...new Set(options.scopes ?? AGENT_GRANT_SCOPES)];
  if (scopes.length === 0 || scopes.some((scope) => !AGENT_GRANT_SCOPES.includes(scope)))
    throw new Error('Agent grant scope is invalid.');
  const id = randomBytes(16).toString('hex');
  const token = randomBytes(32).toString('base64url');
  const createdAt = new Date().toISOString();
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
