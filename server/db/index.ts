import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
export function openDatabase(filename: string): Database.Database {
  if (filename !== ':memory:')
    fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  const db = new Database(filename);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = FULL');
  migrate(db);
  if (filename !== ':memory:') fs.chmodSync(filename, 0o600);
  return db;
}
export function migrate(db: Database.Database) {
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)'
  );
  const version = db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as {
    version: number | null;
  };
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
}
