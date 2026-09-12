import express from 'express';
import request from 'supertest';
import argon2 from 'argon2';
import { afterEach, describe, expect, it } from 'vitest';
import { installAuth } from '../server/auth/index.js';
import { openDatabase } from '../server/db/index.js';
import { loadConfig } from '../server/config.js';
const dbs: ReturnType<typeof openDatabase>[] = [];
afterEach(() => dbs.splice(0).forEach((db) => db.close()));
async function setup(configured = true) {
  const db = openDatabase(':memory:');
  dbs.push(db);
  const app = express();
  app.use(express.json());
  const config = loadConfig({
    OPERATOR_PASSWORD_HASH: configured
      ? await argon2.hash('local-test-password', {
          type: argon2.argon2id,
          memoryCost: 8192,
          timeCost: 1,
        })
      : '',
    SESSION_SECRET: 'a'.repeat(48),
  });
  const { requireOperator } = installAuth(app, db, config);
  app.post('/api/runs', requireOperator, (_req, res) => res.json({ ok: true }));
  app.get('/api/runs/private/export', requireOperator, (_req, res) => res.json({ private: true }));
  return { app, db };
}
describe('operator boundary', () => {
  it('public visitors cannot create live runs or read private exports using mode flags', async () => {
    const { app } = await setup();
    const guest = request.agent(app);
    const s = await guest.get('/api/session');
    expect(s.body.authenticated).toBe(false);
    await guest
      .post('/api/runs')
      .set('Origin', 'http://127.0.0.1:4318')
      .set('x-csrf-token', s.body.csrfToken)
      .send({ mode: 'live', runId: 'private' })
      .expect(401);
    await guest.get('/api/runs/private/export?mode=demo').expect(401);
  });
  it('requires CSRF+origin, rotates sessions and uses HttpOnly SameSite cookies', async () => {
    const { app } = await setup();
    const agent = request.agent(app);
    const initial = await agent.get('/api/session');
    expect(initial.headers['set-cookie'][0]).toMatch(/HttpOnly/);
    expect(initial.headers['set-cookie'][0]).toMatch(/SameSite=Strict/);
    await agent.post('/api/login').send({ password: 'local-test-password' }).expect(403);
    await agent
      .post('/api/login')
      .set('Origin', 'https://evil.example')
      .set('x-csrf-token', initial.body.csrfToken)
      .send({ password: 'local-test-password' })
      .expect(403);
    const login = await agent
      .post('/api/login')
      .set('Origin', 'http://127.0.0.1:4318')
      .set('x-csrf-token', initial.body.csrfToken)
      .send({ password: 'local-test-password' })
      .expect(200);
    expect(login.body.csrfToken).not.toBe(initial.body.csrfToken);
    expect(login.headers['set-cookie'][0].split(';')[0]).not.toBe(
      initial.headers['set-cookie'][0].split(';')[0]
    );
    await agent
      .post('/api/runs')
      .set('Origin', 'http://127.0.0.1:4318')
      .set('x-csrf-token', login.body.csrfToken)
      .send({})
      .expect(200);
    await agent.get('/api/runs/private/export').expect(200);
  });
  it('fails closed when auth configuration is missing', async () => {
    const { app } = await setup(false);
    const agent = request.agent(app);
    const s = await agent.get('/api/session');
    expect(s.body.configured).toBe(false);
    await agent
      .post('/api/login')
      .set('Origin', 'http://127.0.0.1:4318')
      .set('x-csrf-token', s.body.csrfToken)
      .send({ password: 'anything' })
      .expect(503);
  });
  it('throttles login attempts durably', async () => {
    const { app } = await setup();
    const agent = request.agent(app);
    const s = await agent.get('/api/session');
    for (let i = 0; i < 5; i++)
      await agent
        .post('/api/login')
        .set('Origin', 'http://127.0.0.1:4318')
        .set('x-csrf-token', s.body.csrfToken)
        .send({ password: 'wrong' })
        .expect(401);
    await agent
      .post('/api/login')
      .set('Origin', 'http://127.0.0.1:4318')
      .set('x-csrf-token', s.body.csrfToken)
      .send({ password: 'local-test-password' })
      .expect(429);
  });
});
