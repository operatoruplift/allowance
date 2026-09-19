import { afterEach, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp, type RuntimePayments } from '../server/app.js';
import { loadConfig } from '../server/config.js';
import { openDatabase } from '../server/db/index.js';
import { Ledger } from '../server/policy/ledger.js';

const databases: ReturnType<typeof openDatabase>[] = [];
afterEach(() =>
  databases.splice(0).forEach((db) => {
    if (db.open) db.close();
  })
);
function setup() {
  const config = loadConfig({ NODE_ENV: 'production' });
  const db = openDatabase(':memory:');
  databases.push(db);
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
  const app = createApp(config, db, ledger, payments, null, forbidden);
  return { app, db, forbidden };
}
it('health reveals minimal liveness and private APIs fail closed without provider work', async () => {
  const { app, forbidden } = setup();
  const health = await request(app)
    .get('/api/health')
    .set('X-Request-ID', 'caller-controlled')
    .expect(200);
  expect(health.body).toEqual({ ok: true, service: 'Allowance', paymentNetwork: 'mainnet' });
  expect(health.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  expect(health.headers['x-request-id']).not.toBe('caller-controlled');
  for (const route of ['/api/config', '/api/runs', '/api/runs/unknown/export']) {
    const denied = await request(app).get(route).expect(401);
    expect(denied.headers['cache-control']).toBe('no-store');
  }
  expect(forbidden).not.toHaveBeenCalled();
});
it('rejects malformed and oversized input with safe status and correlation identifiers', async () => {
  const { app, forbidden } = setup();
  for (const [body, status] of [
    ['{secret-provider-text', 400],
    [JSON.stringify({ data: 'x'.repeat(25000) }), 413],
  ] as const) {
    const response = await request(app)
      .post('/api/login')
      .set('Content-Type', 'application/json')
      .send(body)
      .expect(status);
    expect(response.body.code).toBe('INVALID_BODY');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.requestId).toBe(response.headers['x-request-id']);
    expect(JSON.stringify(response.body)).not.toContain('secret-provider-text');
    expect(response.body.stack).toBeUndefined();
  }
  expect(forbidden).not.toHaveBeenCalled();
});
