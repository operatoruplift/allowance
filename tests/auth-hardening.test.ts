import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp, type RuntimePayments } from '../server/app.js';
import { loadConfig } from '../server/config.js';
import { openDatabase } from '../server/db/index.js';
import { Ledger } from '../server/policy/ledger.js';
import { API_REQUESTS_PER_MINUTE, LOGIN_REQUESTS_PER_WINDOW } from '../server/auth/rate-limit.js';
import {
  AUTH_MAINTENANCE_INTERVAL_MS,
  pruneExpiredAuthRows,
  startAuthMaintenance,
} from '../server/auth/maintenance.js';

const dbs: ReturnType<typeof openDatabase>[] = [];
afterEach(() => {
  dbs.splice(0).forEach((db) => db.open && db.close());
  vi.useRealTimers();
});

function setup() {
  const config = loadConfig({});
  const db = openDatabase(':memory:');
  dbs.push(db);
  const ledger = new Ledger(db, config);
  const forbidden = vi.fn(async () => {
    throw new Error('Provider must not run.');
  });
  const payments: RuntimePayments = {
    mountMerchant: () => {},
    readiness: forbidden,
    reconcile: forbidden,
    runPaidTool: forbidden,
  };
  return { app: createApp(config, db, ledger, payments, null, forbidden), db };
}
const count = (db: ReturnType<typeof openDatabase>, table: 'sessions' | 'login_attempts') =>
  (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

describe('API rate limiting', () => {
  it('answers 429 once one address exceeds the per-minute ceiling on /api', async () => {
    const { app } = setup();
    const client = request(app);
    for (let i = 0; i < API_REQUESTS_PER_MINUTE; i++) await client.get('/api/health').expect(200);
    const limited = await client.get('/api/health').expect(429);
    expect(limited.body).toMatchObject({ code: 'RATE_LIMITED' });
    expect(limited.headers['cache-control']).toBe('no-store');
    expect(Object.keys(limited.headers).some((name) => name.startsWith('ratelimit'))).toBe(true);
    expect(limited.headers['x-ratelimit-limit']).toBeUndefined();
  }, 30_000);
  it('caps sign-in requests per address ahead of the durable lockout', async () => {
    const { app } = setup();
    const client = request(app);
    for (let i = 0; i < LOGIN_REQUESTS_PER_WINDOW; i++)
      await client.post('/api/login').send({ password: 'x' }).expect(403);
    const limited = await client.post('/api/login').send({ password: 'x' }).expect(429);
    expect(limited.body).toMatchObject({ code: 'RATE_LIMITED' });
    // Other routes are untouched by the sign-in ceiling.
    await client.get('/api/health').expect(200);
  });
});

describe('auth maintenance', () => {
  it('prunes expired sessions and lapsed lockout counters while keeping live rows', () => {
    const { db } = setup();
    const now = Date.now();
    db.prepare('INSERT INTO sessions VALUES(?,?,?)').run('live', now + 60_000, '{}');
    db.prepare('INSERT INTO sessions VALUES(?,?,?)').run('stale', now - 1, '{}');
    db.prepare('INSERT INTO login_attempts VALUES(?,?,?)').run('ip:live', 2, now + 60_000);
    db.prepare('INSERT INTO login_attempts VALUES(?,?,?)').run('ip:stale', 5, now - 1);
    expect(pruneExpiredAuthRows(db, now)).toEqual({ sessions: 1, attempts: 1 });
    expect(db.prepare('SELECT sid FROM sessions').all()).toEqual([{ sid: 'live' }]);
    expect(db.prepare('SELECT key FROM login_attempts').all()).toEqual([{ key: 'ip:live' }]);
  });
  it('runs at start and on its timer until stopped', () => {
    vi.useFakeTimers();
    const db = openDatabase(':memory:');
    dbs.push(db);
    let clock = Date.parse('2026-10-24T00:00:00.000Z');
    db.prepare('INSERT INTO sessions VALUES(?,?,?)').run('already-gone', clock - 1, '{}');
    db.prepare('INSERT INTO sessions VALUES(?,?,?)').run('soon', clock + 10 * 60_000, '{}');
    const stop = startAuthMaintenance(db, AUTH_MAINTENANCE_INTERVAL_MS, () => clock);
    expect(count(db, 'sessions')).toBe(1);
    clock += AUTH_MAINTENANCE_INTERVAL_MS;
    vi.advanceTimersByTime(AUTH_MAINTENANCE_INTERVAL_MS);
    expect(count(db, 'sessions')).toBe(0);
    stop();
    db.prepare('INSERT INTO sessions VALUES(?,?,?)').run('after-stop', clock - 1, '{}');
    vi.advanceTimersByTime(AUTH_MAINTENANCE_INTERVAL_MS);
    expect(count(db, 'sessions')).toBe(1);
  });
});
