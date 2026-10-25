import express from 'express';
import request from 'supertest';
import argon2 from 'argon2';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installAuth } from '../server/auth/index.js';
import { openDatabase } from '../server/db/index.js';
import { loadConfig } from '../server/config.js';
const dbs: ReturnType<typeof openDatabase>[] = [];
afterEach(() => dbs.splice(0).forEach((db) => db.close()));
async function setup(
  configured = true,
  environment: NodeJS.ProcessEnv = {},
  onLogout: () => void = () => {}
) {
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
    ...environment,
  });
  if (config.proxyHops) app.set('trust proxy', config.proxyHops);
  const { requireOperator } = installAuth(app, db, config, onLogout);
  app.post('/api/runs', requireOperator, (_req, res) => res.json({ ok: true }));
  app.get('/api/runs/private/export', requireOperator, (_req, res) => res.json({ private: true }));
  return { app, db };
}
const origin = 'http://127.0.0.1:4318';
/** The Set-Cookie line for one cookie name, so assertions do not depend on header order. */
const cookie = (response: request.Response, name: string): string | undefined =>
  ((response.headers['set-cookie'] as unknown as string[] | undefined) ?? []).find((value) =>
    value.startsWith(`${name}=`)
  );
const sessionRows = (db: ReturnType<typeof openDatabase>) =>
  (db.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number }).n;
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
    const { app, db } = await setup();
    const agent = request.agent(app);
    const initial = await agent.get('/api/session');
    // A visitor gets a signed CSRF cookie and no session: nothing is persisted before sign-in.
    const anonymous = cookie(initial, 'allowance.csrf');
    expect(anonymous).toMatch(/HttpOnly/);
    expect(anonymous).toMatch(/SameSite=Strict/);
    expect(cookie(initial, 'allowance.sid')).toBeUndefined();
    expect(sessionRows(db)).toBe(0);
    await agent.post('/api/login').send({ password: 'local-test-password' }).expect(403);
    await agent
      .post('/api/login')
      .set('Origin', 'https://evil.example')
      .set('x-csrf-token', initial.body.csrfToken)
      .send({ password: 'local-test-password' })
      .expect(403);
    const login = await agent
      .post('/api/login')
      .set('Origin', origin)
      .set('x-csrf-token', initial.body.csrfToken)
      .send({ password: 'local-test-password' })
      .expect(200);
    expect(login.body.csrfToken).not.toBe(initial.body.csrfToken);
    const sessionCookie = cookie(login, 'allowance.sid');
    expect(sessionCookie).toMatch(/HttpOnly/);
    expect(sessionCookie).toMatch(/SameSite=Strict/);
    expect(sessionRows(db)).toBe(1);
    // Signing in again regenerates the session id and still leaves one row.
    const again = await agent
      .post('/api/login')
      .set('Origin', origin)
      .set('x-csrf-token', login.body.csrfToken)
      .send({ password: 'local-test-password' })
      .expect(200);
    expect(cookie(again, 'allowance.sid')?.split(';')[0]).not.toBe(sessionCookie?.split(';')[0]);
    expect(sessionRows(db)).toBe(1);
    await agent
      .post('/api/runs')
      .set('Origin', origin)
      .set('x-csrf-token', again.body.csrfToken)
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
  it('persists no session for visitors and refuses a CSRF token without its signed cookie', async () => {
    const { app, db } = await setup();
    const agent = request.agent(app);
    const first = await agent.get('/api/session');
    const second = await agent.get('/api/session');
    expect(second.body.csrfToken).toBe(first.body.csrfToken);
    expect(second.headers['set-cookie']).toBeUndefined();
    expect(sessionRows(db)).toBe(0);
    // The token alone, or a cookie forged without the secret, does not pass.
    await request(app)
      .post('/api/login')
      .set('Origin', origin)
      .set('x-csrf-token', first.body.csrfToken)
      .send({ password: 'local-test-password' })
      .expect(403);
    await request(app)
      .post('/api/login')
      .set('Cookie', `allowance.csrf=${'a'.repeat(64)}.${'b'.repeat(64)}`)
      .set('Origin', origin)
      .set('x-csrf-token', 'a'.repeat(64))
      .send({ password: 'local-test-password' })
      .expect(403);
    expect(sessionRows(db)).toBe(0);
  });
  it('locks out sign-in per address, not for everyone, and clears that counter on success', async () => {
    const { app, db } = await setup(true, { PROXY_HOPS: '1' });
    const attacker = '198.51.100.7';
    const operator = '203.0.113.5';
    const attempt = async (ip: string, password: string) => {
      const agent = request.agent(app);
      const s = await agent.get('/api/session').set('X-Forwarded-For', ip);
      return agent
        .post('/api/login')
        .set('X-Forwarded-For', ip)
        .set('Origin', origin)
        .set('x-csrf-token', s.body.csrfToken)
        .send({ password });
    };
    for (let i = 0; i < 5; i++) expect((await attempt(attacker, 'wrong')).status).toBe(401);
    expect((await attempt(attacker, 'local-test-password')).status).toBe(429);
    expect((await attempt(operator, 'wrong')).status).toBe(401);
    expect((await attempt(operator, 'local-test-password')).status).toBe(200);
    expect(db.prepare('SELECT key,count FROM login_attempts ORDER BY key').all()).toEqual([
      { key: `ip:${attacker}`, count: 5 },
    ]);
  });
  it('sets host-only Secure cookies only through the explicitly trusted HTTPS proxy', async () => {
    const environment = { NODE_ENV: 'production', APP_ORIGIN: 'https://console.example' };
    const direct = await setup(true, environment);
    const spoofed = await request(direct.app).get('/api/session').set('X-Forwarded-Proto', 'https');
    expect(spoofed.headers['set-cookie']).toBeUndefined();

    const trusted = await setup(true, { ...environment, PROXY_HOPS: '1' });
    const session = await request(trusted.app)
      .get('/api/session')
      .set('X-Forwarded-Proto', 'https');
    // Before sign-in the only cookie is the signed CSRF cookie, host-only and Secure.
    const csrfCookie = cookie(session, '__Host-allowance-csrf');
    expect(csrfCookie).toBeDefined();
    expect(cookie(session, '__Host-allowance')).toBeUndefined();
    expect(csrfCookie).toMatch(/; Secure/);
    expect(csrfCookie).toMatch(/; HttpOnly/);
    expect(csrfCookie).toMatch(/; Path=\//);
    expect(csrfCookie).not.toMatch(/Domain=/);
    expect(session.headers['cache-control']).toBe('no-store');
    const result = await request(trusted.app)
      .post('/api/login')
      .set('X-Forwarded-Proto', 'https')
      .set('Cookie', csrfCookie!.split(';')[0])
      .set('Origin', environment.APP_ORIGIN)
      .set('x-csrf-token', session.body.csrfToken)
      .send({ password: 'local-test-password' })
      .expect(200);
    const sessionCookie = cookie(result, '__Host-allowance');
    expect(sessionCookie).toMatch(/; Secure/);
    expect(sessionCookie).toMatch(/; HttpOnly/);
    expect(sessionCookie).toMatch(/; Path=\//);
    expect(sessionCookie).not.toMatch(/Domain=/);
    expect(result.headers['cache-control']).toBe('no-store');
  });
  it('expires authenticated sessions durably and never caches private responses', async () => {
    const { app, db } = await setup();
    const agent = request.agent(app);
    const session = await agent.get('/api/session');
    const login = await agent
      .post('/api/login')
      .set('Origin', 'http://127.0.0.1:4318')
      .set('x-csrf-token', session.body.csrfToken)
      .send({ password: 'local-test-password' })
      .expect(200);
    const privateResponse = await agent.get('/api/runs/private/export').expect(200);
    expect(privateResponse.headers['cache-control']).toBe('no-store');
    const row = db.prepare('SELECT sid,data FROM sessions').get() as { sid: string; data: string };
    const data = JSON.parse(row.data);
    data.issuedAt = Date.now() - 8 * 60 * 60 * 1000 - 1;
    db.prepare('UPDATE sessions SET data=? WHERE sid=?').run(JSON.stringify(data), row.sid);
    const expired = await agent.get('/api/runs/private/export').expect(401);
    expect(expired.headers['cache-control']).toBe('no-store');
    expect(db.prepare('SELECT sid FROM sessions WHERE sid=?').get(row.sid)).toBeUndefined();
    await agent
      .post('/api/runs')
      .set('Origin', 'http://127.0.0.1:4318')
      .set('x-csrf-token', login.body.csrfToken)
      .send({})
      .expect(403);
  });
  it('logout stops new built-in work only after authenticating the mutation and destroys access', async () => {
    const stop = vi.fn();
    const { app } = await setup(true, { NODE_ENV: 'production' }, stop);
    const agent = request.agent(app);
    const session = await agent.get('/api/session');
    const login = await agent
      .post('/api/login')
      .set('Origin', 'http://127.0.0.1:4318')
      .set('x-csrf-token', session.body.csrfToken)
      .send({ password: 'local-test-password' })
      .expect(200);
    await agent.post('/api/logout').send({}).expect(403);
    expect(stop).not.toHaveBeenCalled();
    const logout = await agent
      .post('/api/logout')
      .set('Origin', 'http://127.0.0.1:4318')
      .set('x-csrf-token', login.body.csrfToken)
      .send({})
      .expect(200);
    expect(stop).toHaveBeenCalledOnce();
    expect(logout.headers['set-cookie'][0]).toMatch(/^allowance.sid=;/);
    expect(logout.headers['set-cookie'][0]).not.toMatch(/; Secure/);
    await agent.get('/api/runs/private/export').expect(401);
  });
});
