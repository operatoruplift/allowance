import { expect, it } from 'vitest';
import { openDatabase } from '../server/db/index.js';
import { acquireServiceLease } from '../server/db/lease.js';
it('a second service cannot recover active state; an expired owner cannot sign after takeover', () => {
  const db = openDatabase(':memory:');
  let now = 1000;
  try {
    const first = acquireServiceLease(db, () => now);
    expect(() => acquireServiceLease(db, () => now)).toThrow(/Another Allowance/);
    first.renew();
    now += 20001;
    const replacement = acquireServiceLease(db, () => now);
    expect(() => first.assert()).toThrow(/ownership expired/);
    expect(() => first.renew()).toThrow();
    first.release();
    replacement.assert();
    replacement.release();
    expect(() => replacement.assert()).toThrow();
  } finally {
    db.close();
  }
});
