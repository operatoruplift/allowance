import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
/** One service owns startup recovery. Spending still requires the transactional ledger. */
export function acquireServiceLease(db: Database.Database, now: () => number = Date.now) {
  const owner = randomUUID();
  const ttl = 20000;
  db.exec(
    'CREATE TABLE IF NOT EXISTS service_lease (singleton INTEGER PRIMARY KEY CHECK(singleton=1),owner TEXT NOT NULL,expires INTEGER NOT NULL)'
  );
  db.transaction(() => {
    const current = db.prepare('SELECT expires FROM service_lease WHERE singleton=1').get() as
      { expires: number } | undefined;
    if (current && current.expires > now())
      throw new Error(
        'Another Allowance service owns this database. Stop it first; after a crash, wait 20 seconds for the lease to expire.'
      );
    db.prepare(
      'INSERT INTO service_lease VALUES(1,?,?) ON CONFLICT(singleton) DO UPDATE SET owner=excluded.owner,expires=excluded.expires'
    ).run(owner, now() + ttl);
  }).immediate();
  const assert = () => {
    const row = db.prepare('SELECT owner,expires FROM service_lease WHERE singleton=1').get() as
      { owner: string; expires: number } | undefined;
    if (!row || row.owner !== owner || row.expires <= now())
      throw new Error('Service ownership expired. New spending is denied.');
  };
  return {
    assert,
    renew() {
      db.transaction(() => {
        assert();
        db.prepare('UPDATE service_lease SET expires=? WHERE singleton=1 AND owner=?').run(
          now() + ttl,
          owner
        );
      }).immediate();
    },
    release() {
      if (db.open) db.prepare('DELETE FROM service_lease WHERE singleton=1 AND owner=?').run(owner);
    },
  };
}
