import { expect, it } from 'vitest';
import { openDatabase } from '../server/db/index.js';
import { acquireServiceLease, createSharedServiceGuard } from '../server/db/lease.js';
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

it('shared bridge pins the authoritative owner and cannot adopt a replacement lease', () => {
  const db = openDatabase(':memory:');
  let now = 1000;
  try {
    const earlyBridge = createSharedServiceGuard(db, () => now);
    const first = acquireServiceLease(db, () => now);
    const bridge = createSharedServiceGuard(db, () => now);
    expect(() => earlyBridge()).toThrow(/No authoritative/);
    expect(() => bridge()).not.toThrow();
    now += 20001;
    const replacement = acquireServiceLease(db, () => now);
    expect(() => bridge()).toThrow(/changed or expired/);
    expect(() => createSharedServiceGuard(db, () => now)()).not.toThrow();
    first.release();
    replacement.release();
  } finally {
    db.close();
  }
});
