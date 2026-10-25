import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../server/db/index.js';
import {
  DAILY_VERIFICATION_QUOTA,
  initializeMerchantStore,
  verifiedReceiptsToday,
} from '../server/merchant/http.js';

const dbs: ReturnType<typeof openDatabase>[] = [];
afterEach(() => dbs.splice(0).forEach((db) => db.open && db.close()));

/** `created_at` defaults to CURRENT_TIMESTAMP, which SQLite writes as UTC `YYYY-MM-DD HH:MM:SS`. */
const sqliteNow = (offsetMs = 0) =>
  new Date(Date.now() + offsetMs).toISOString().replace('T', ' ').slice(0, 19);

describe('merchant daily verification quota', () => {
  it('counts only receipts the facilitator verified, never rejected or unfinished payloads', () => {
    const db = openDatabase(':memory:');
    dbs.push(db);
    initializeMerchantStore(db);
    const insert = db.prepare(
      "INSERT INTO merchant_receipts(id,canonical_hash,payload_hash,payer,status,payload_json,requirements_json,created_at) VALUES(?,?,?,?,?,'{}','{}',?)"
    );
    // An outsider with a throwaway key can produce these two at will; they must not count.
    for (let i = 0; i < 50; i++) insert.run(`rejected-${i}`, 'hash', `rejected-payload-${i}`, 'outsider', 'rejected', sqliteNow());
    for (let i = 0; i < 50; i++) insert.run(`stuck-${i}`, 'hash', `stuck-payload-${i}`, 'outsider', 'verifying', sqliteNow());
    // Verified payments, whatever happened after verification, do count.
    for (const [index, status] of ['verified', 'settling', 'settled', 'unknown'].entries())
      insert.run(`paid-${index}`, 'hash', `paid-payload-${index}`, 'runner', status, sqliteNow());
    // Yesterday's verified payments have rolled out of the window.
    insert.run('old', 'hash', 'old-payload', 'runner', 'settled', sqliteNow(-25 * 60 * 60 * 1000));
    expect(verifiedReceiptsToday(db)).toBe(4);
    expect(DAILY_VERIFICATION_QUOTA).toBe(1000);
  });
});
