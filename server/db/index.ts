import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
export const SCHEMA_VERSION = 4;
export function openDatabase(filename: string): Database.Database {
  if (filename !== ':memory:')
    fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  const db = new Database(filename);
  try {
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    db.pragma('synchronous = FULL');
    migrate(db);
    if (filename !== ':memory:') fs.chmodSync(filename, 0o600);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
export function migrate(db: Database.Database) {
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)'
  );
  const version = db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as {
    version: number | null;
  };
  if ((version.version || 0) > SCHEMA_VERSION)
    throw new Error(
      'Database schema is newer than this application. Restore compatible code, not an older ledger.'
    );
  if ((version.version || 0) < 1)
    db.transaction(() => {
      db.exec(`
      CREATE TABLE runs (id TEXT PRIMARY KEY, owner TEXT NOT NULL, wallet TEXT NOT NULL, task TEXT NOT NULL, status TEXT NOT NULL, policy TEXT NOT NULL, created_at TEXT NOT NULL, data_network TEXT NOT NULL, report TEXT, error TEXT, llm_calls INTEGER NOT NULL DEFAULT 0, input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE intents (id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id), request_hash TEXT NOT NULL, tool TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount>=0 AND amount<=1000000000000), status TEXT NOT NULL, created_at TEXT NOT NULL, day TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'agent', reason TEXT, signed_identity TEXT, signature TEXT, chain_verified INTEGER NOT NULL DEFAULT 0, result TEXT, service_outcome TEXT NOT NULL DEFAULT 'pending', payload TEXT, evidence TEXT, recovery_attempts INTEGER NOT NULL DEFAULT 0, UNIQUE(run_id,request_hash));
      CREATE INDEX intents_run ON intents(run_id);
      CREATE INDEX intents_day ON intents(day);
      CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL REFERENCES runs(id), at TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, detail TEXT NOT NULL, source TEXT NOT NULL);
      CREATE TABLE sessions (sid TEXT PRIMARY KEY, expires INTEGER NOT NULL, data TEXT NOT NULL);
      CREATE TABLE login_attempts (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL);
    `);
      db.prepare('INSERT INTO schema_migrations VALUES(1,?)').run(new Date().toISOString());
    }).immediate();
  const latest = db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as {
    version: number | null;
  };
  if ((latest.version || 0) < 2)
    db.transaction(() => {
      db.exec(`
        ALTER TABLE runs ADD COLUMN execution_mode TEXT NOT NULL DEFAULT 'builtin' CHECK(execution_mode IN ('builtin','external'));
        CREATE TABLE agent_grants (
          id TEXT PRIMARY KEY,
          token_hash TEXT NOT NULL UNIQUE,
          run_id TEXT NOT NULL REFERENCES runs(id),
          owner TEXT NOT NULL,
          session_id TEXT NOT NULL,
          scopes TEXT NOT NULL,
          expires_at INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          revoked_at INTEGER,
          last_used_at INTEGER
        );
        CREATE INDEX agent_grants_run ON agent_grants(run_id);
        CREATE INDEX agent_grants_session ON agent_grants(session_id);
      `);
      db.prepare('INSERT INTO schema_migrations VALUES(2,?)').run(new Date().toISOString());
    }).immediate();
  if ((latest.version || 0) < 3)
    db.transaction(() => {
      db.exec(`CREATE TABLE restore_recoveries (
        id TEXT PRIMARY KEY, backup_id TEXT NOT NULL, backup_completed_at TEXT NOT NULL,
        restored_at TEXT NOT NULL, approved_at TEXT, approval_json TEXT
      ) STRICT;`);
      db.prepare('INSERT INTO schema_migrations VALUES(3,?)').run(new Date().toISOString());
    }).immediate();
  if ((latest.version || 0) < 4)
    db.transaction(() => {
      // Mandates: the second frozen authority. Direct payments share the payer, the
      // day and the hold semantics with x402 intents, so both rails are read together.
      db.exec(`
        CREATE TABLE mandates (
          id TEXT PRIMARY KEY, owner TEXT NOT NULL, label TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('active','stopped','expired')),
          policy TEXT NOT NULL, created_at TEXT NOT NULL, stopped_at TEXT
        ) STRICT;
        CREATE TABLE mandate_recipients (
          mandate_id TEXT NOT NULL REFERENCES mandates(id), address TEXT NOT NULL, label TEXT NOT NULL,
          added_at TEXT NOT NULL, added_by TEXT NOT NULL CHECK(added_by IN ('operator','admin-signature')),
          approval TEXT, PRIMARY KEY(mandate_id, address)
        ) STRICT;
        CREATE TABLE direct_payments (
          id TEXT PRIMARY KEY, mandate_id TEXT NOT NULL REFERENCES mandates(id), request_hash TEXT NOT NULL,
          recipient TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount>=0 AND amount<=1000000000000), memo TEXT,
          status TEXT NOT NULL, reason_code TEXT, reason TEXT, created_at TEXT NOT NULL, day TEXT NOT NULL,
          source TEXT NOT NULL, signed_identity TEXT, signature TEXT, chain_verified INTEGER NOT NULL DEFAULT 0,
          evidence TEXT
        ) STRICT;
        CREATE INDEX direct_payments_mandate ON direct_payments(mandate_id);
        CREATE INDEX direct_payments_request_hash ON direct_payments(mandate_id, request_hash);
        CREATE INDEX direct_payments_day ON direct_payments(day);
        CREATE INDEX direct_payments_status ON direct_payments(status);
        CREATE TABLE mandate_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT, mandate_id TEXT NOT NULL REFERENCES mandates(id),
          at TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, detail TEXT NOT NULL, source TEXT NOT NULL
        ) STRICT;
        CREATE TABLE mandate_grants (
          id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, mandate_id TEXT NOT NULL REFERENCES mandates(id),
          owner TEXT NOT NULL, session_id TEXT NOT NULL, scopes TEXT NOT NULL, expires_at INTEGER NOT NULL,
          created_at TEXT NOT NULL, revoked_at INTEGER, last_used_at INTEGER
        ) STRICT;
        CREATE INDEX mandate_grants_mandate ON mandate_grants(mandate_id);
        CREATE INDEX mandate_grants_session ON mandate_grants(session_id);
        CREATE TABLE approval_nonces (
          nonce TEXT PRIMARY KEY, mandate_id TEXT NOT NULL, signer TEXT NOT NULL, used_at TEXT NOT NULL
        ) STRICT;
      `);
      db.prepare('INSERT INTO schema_migrations VALUES(4,?)').run(new Date().toISOString());
    }).immediate();
}
