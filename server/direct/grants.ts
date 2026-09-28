import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type Database from 'better-sqlite3';
import { AgentGrantError, assertGrantSession } from '../mcp/grants.js';
import type { MandateLedger } from './ledger.js';

/**
 * A mandate grant is the human authority behind an agent's direct payments: one
 * opaque token per mandate, stored hashed, bound to the operator session that
 * issued it, expiring with the frozen mandate and revoked on logout or stop.
 */
export const MANDATE_GRANT_SCOPES = [
  'get_mandate',
  'execute_guarded_payment',
  'list_direct_payments',
  'add_recipient_to_allowlist',
  'stop_mandate',
] as const;
export type MandateGrantScope = (typeof MANDATE_GRANT_SCOPES)[number];

interface GrantRow {
  id: string;
  token_hash: string;
  mandate_id: string;
  owner: string;
  session_id: string;
  scopes: string;
  expires_at: number;
  created_at: string;
  revoked_at: number | null;
  last_used_at: number | null;
}
export interface MandateGrant {
  id: string;
  mandateId: string;
  owner: string;
  sessionId: string;
  scopes: MandateGrantScope[];
  expiresAt: string;
  revokedAt: string | null;
}

const hashToken = (token: string) => createHash('sha256').update(token, 'utf8').digest('hex');

function parseScopes(raw: string): MandateGrantScope[] {
  const value: unknown = JSON.parse(raw);
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((scope) => !MANDATE_GRANT_SCOPES.includes(scope as MandateGrantScope))
  )
    throw new Error('Stored mandate grant scopes are invalid.');
  return [...new Set(value)] as MandateGrantScope[];
}

function toGrant(row: GrantRow): MandateGrant {
  return {
    id: row.id,
    mandateId: row.mandate_id,
    owner: row.owner,
    sessionId: row.session_id,
    scopes: parseScopes(row.scopes),
    expiresAt: new Date(row.expires_at).toISOString(),
    revokedAt: row.revoked_at === null ? null : new Date(row.revoked_at).toISOString(),
  };
}

export function createMandateGrant(
  db: Database.Database,
  mandates: MandateLedger,
  options: {
    mandateId: string;
    owner: string;
    sessionId: string;
    expiresAt: string;
    scopes?: MandateGrantScope[];
  }
) {
  const mandate = mandates.get(options.mandateId, options.owner);
  if (mandate.status !== 'active') throw new Error('Mandate is no longer available to an agent.');
  const expiresAt = Date.parse(options.expiresAt);
  if (
    !Number.isSafeInteger(expiresAt) ||
    expiresAt <= Date.now() ||
    expiresAt > Date.parse(mandate.policy.expiresAt)
  )
    throw new Error('Mandate grant expiry is invalid or already elapsed.');
  assertGrantSession(db, options.sessionId, options.owner);
  const scopes = [...new Set(options.scopes ?? MANDATE_GRANT_SCOPES)];
  if (scopes.length === 0 || scopes.some((scope) => !MANDATE_GRANT_SCOPES.includes(scope)))
    throw new Error('Mandate grant scope is invalid.');
  const id = randomBytes(16).toString('hex');
  const token = randomBytes(32).toString('base64url');
  const createdAt = new Date().toISOString();
  db.transaction(() => {
    if (db.prepare('SELECT 1 FROM mandate_grants WHERE mandate_id=? LIMIT 1').get(options.mandateId))
      throw new AgentGrantError(
        'GRANT_INVALID',
        'This mandate already has its one human grant. Authorize a new mandate instead.'
      );
    db.prepare(
      'INSERT INTO mandate_grants(id,token_hash,mandate_id,owner,session_id,scopes,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?)'
    ).run(
      id,
      hashToken(token),
      options.mandateId,
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
      mandateId: options.mandateId,
      owner: options.owner,
      sessionId: options.sessionId,
      scopes,
      expiresAt: new Date(expiresAt).toISOString(),
      revokedAt: null,
    } satisfies MandateGrant,
    token,
  };
}

/** Called again inside the durable signing claim, after any asynchronous chain work. */
export function assertMandateAuthorization(
  db: Database.Database,
  mandateId: string,
  owner: string,
  scope: MandateGrantScope,
  now = Date.now()
) {
  const rows = db.prepare('SELECT * FROM mandate_grants WHERE mandate_id=?').all(mandateId) as GrantRow[];
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
    'No active human authorization permits this direct payment.'
  );
}

export function authorizeMandateGrant(
  db: Database.Database,
  token: string,
  mandateId: string,
  scope: MandateGrantScope
): MandateGrant {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token))
    throw new AgentGrantError('GRANT_INVALID', 'Mandate grant is invalid.');
  const row = db.prepare('SELECT * FROM mandate_grants WHERE token_hash=?').get(hashToken(token)) as
    GrantRow | undefined;
  if (!row) throw new AgentGrantError('GRANT_INVALID', 'Mandate grant is invalid.');
  const expected = Buffer.from(row.token_hash, 'hex');
  const actual = Buffer.from(hashToken(token), 'hex');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
    throw new AgentGrantError('GRANT_INVALID', 'Mandate grant is invalid.');
  if (row.mandate_id !== mandateId)
    throw new AgentGrantError('GRANT_INVALID', 'Mandate grant is invalid.');
  if (row.revoked_at !== null)
    throw new AgentGrantError('GRANT_REVOKED', 'Mandate grant is revoked.');
  if (row.expires_at <= Date.now())
    throw new AgentGrantError('GRANT_EXPIRED', 'Mandate grant is expired.');
  assertGrantSession(db, row.session_id, row.owner);
  const mandate = db.prepare('SELECT owner FROM mandates WHERE id=?').get(mandateId) as
    { owner: string } | undefined;
  if (!mandate || mandate.owner !== row.owner)
    throw new AgentGrantError('GRANT_INVALID', 'Mandate grant is invalid.');
  const grant = toGrant(row);
  if (!grant.scopes.includes(scope))
    throw new AgentGrantError('GRANT_SCOPE_DENIED', 'Mandate grant does not allow this tool.');
  db.prepare('UPDATE mandate_grants SET last_used_at=? WHERE id=?').run(Date.now(), row.id);
  return grant;
}

export function revokeMandateGrant(db: Database.Database, mandateId: string, owner: string) {
  db.prepare(
    'UPDATE mandate_grants SET revoked_at=COALESCE(revoked_at,?) WHERE mandate_id=? AND owner=?'
  ).run(Date.now(), mandateId, owner);
}

export function revokeSessionMandateGrants(db: Database.Database, sessionId: string) {
  if (sessionId)
    db.prepare(
      'UPDATE mandate_grants SET revoked_at=COALESCE(revoked_at,?) WHERE session_id=?'
    ).run(Date.now(), sessionId);
}
