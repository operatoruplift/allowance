import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import argon2 from 'argon2';
import { generateKeyPairSigner } from '@solana/kit';
import { TOKEN_PROGRAM_ADDRESS, findAssociatedTokenPda } from '@solana-program/token';
import { createApp, type RuntimePayments } from '../server/app.js';
import { loadConfig } from '../server/config.js';
import { openDatabase } from '../server/db/index.js';
import { Ledger } from '../server/policy/ledger.js';
import { MandateLedger } from '../server/direct/ledger.js';
import { createDirectPaymentService } from '../server/direct/service.js';
import { PAYMENT_CHAINS } from '../shared/domain.js';
import { FakeChain } from './fixtures/direct-chain.js';

const dbs: ReturnType<typeof openDatabase>[] = [];
afterEach(() => dbs.splice(0).forEach((db) => db.open && db.close()));
const origin = 'http://127.0.0.1:4318';
const ata = async (owner: string) =>
  String((await findAssociatedTokenPda({ owner: owner as never, mint: PAYMENT_CHAINS.devnet.mint as never, tokenProgram: TOKEN_PROGRAM_ADDRESS }))[0]);

async function setup(directEnabled = true) {
  const payer = await generateKeyPairSigner();
  const vendor = await generateKeyPairSigner();
  const chain = new FakeChain();
  chain.fund(await ata(payer.address), payer.address, 5_000_000n);
  chain.lamports.set(payer.address, 50_000_000n);
  const db = openDatabase(':memory:');
  dbs.push(db);
  const config = loadConfig({
    OPERATOR_PASSWORD_HASH: await argon2.hash('local-test-password', { type: argon2.argon2id, memoryCost: 8192, timeCost: 1 }),
    SESSION_SECRET: 'a'.repeat(48),
    PAYMENT_NETWORK: 'devnet',
    PAYMENT_RPC_URL: 'https://api.devnet.solana.com',
    DIRECT_PAYMENTS_ENABLED: directEnabled ? 'true' : 'false',
    DAILY_USDC_CEILING: '1000.000000',
    MERCHANT_RECIPIENT: '11111111111111111111111111111111',
  });
  const ledger = new Ledger(db, config);
  const mandates = new MandateLedger(db, config, ledger);
  const direct = await createDirectPaymentService(config, { ledger, mandates }, { rpc: chain, signer: directEnabled ? payer : undefined, sleep: async () => {}, confirmTimeoutMs: 5_000 });
  const forbidden = vi.fn(async () => {
    throw new Error('Provider must not run.');
  });
  const payments: RuntimePayments = {
    mountMerchant: () => {},
    readiness: async () => ({ ready: false, items: [], payer: null, balance: { usdc: null, sol: null } }),
    reconcile: async () => {},
    runPaidTool: forbidden,
  };
  const app = createApp(config, db, ledger, payments, null, async () => ({}), { mandates, direct });
  const agent = request.agent(app);
  const session = await agent.get('/api/session');
  await agent.post('/api/login').set('Origin', origin).set('x-csrf-token', session.body.csrfToken as string).send({ password: 'local-test-password' }).expect(200);
  // Login rotates the session, so mutations use the token issued afterwards.
  const csrf = (await agent.get('/api/session')).body.csrfToken as string;
  const post = (path: string, body: object) => agent.post(path).set('Origin', origin).set('x-csrf-token', csrf).send(body);
  return { app, agent, post, chain, payer, vendor, db, mandates };
}
const mandateBody = (vendor: string) => ({
  label: 'Vendors',
  perRequestCap: '0.020000',
  ceiling: '0.050000',
  expiresInMinutes: 30,
  recipients: [{ address: vendor, label: 'Vendor' }],
});

describe('mandate operator API', () => {
  it('keeps mandates private and answers unauthenticated callers with 401 and no-store', async () => {
    const { app } = await setup();
    for (const route of ['/api/mandates', '/api/mandates/00000000-0000-4000-8000-000000000000']) {
      const denied = await request(app).get(route).expect(401);
      expect(denied.headers['cache-control']).toBe('no-store');
    }
  });
  it('refuses to authorize a mandate while direct payments are disabled or unverified', async () => {
    const disabled = await setup(false);
    const refused = await disabled.post('/api/mandates', mandateBody(disabled.vendor.address)).expect(503);
    expect(refused.body.code).toBe('DIRECT_DISABLED');
    const unverified = await setup();
    const notReady = await unverified.post('/api/mandates', mandateBody(unverified.vendor.address)).expect(503);
    expect(notReady.body.code).toBe('DIRECT_NOT_READY');
  });
  it('authorizes a mandate after a fresh readiness check, returns the grant once, pays and exports', async () => {
    const { agent, post, chain, vendor } = await setup();
    const preflight = await post('/api/preflight', {}).expect(200);
    expect(preflight.body.direct).toMatchObject({ enabled: true, ready: true, network: 'devnet' });
    expect(preflight.body.direct.items.map((item: { name: string; ready: boolean }) => [item.name, item.ready])).toEqual(
      expect.arrayContaining([['Direct payments opt-in', true], ['Payer signer', true], ['Payment RPC', true], ['Payer USDC account', true], ['Payer SOL', true]])
    );
    const created = await post('/api/mandates', mandateBody(vendor.address)).expect(201);
    expect(created.body.grant.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(created.body.mandate).toMatchObject({ status: 'active', remaining: '50000' });
    const id = created.body.mandate.id as string;
    const listed = await agent.get('/api/mandates').expect(200);
    expect(JSON.stringify(listed.body)).not.toContain(created.body.grant.token);
    const blocked = await post(`/api/mandates/${id}/payments`, { requestId: 'req_0000000000000001', recipient: '11111111111111111111111111111111', amount: '0.010000' }).expect(409);
    expect(blocked.body.payment).toMatchObject({ status: 'denied', reasonCode: 'recipient-not-allowlisted' });
    const paid = await post(`/api/mandates/${id}/payments`, { requestId: 'req_0000000000000002', recipient: vendor.address, amount: '0.010000' }).expect(201);
    expect(paid.body.payment).toMatchObject({ status: 'settled', chainVerified: true, source: 'operator' });
    expect(paid.body.mandate).toMatchObject({ settled: '10000', remaining: '40000' });
    expect(chain.methods('sendTransaction')).toHaveLength(1);
    const exported = await agent.get(`/api/mandates/${id}/export`).expect(200);
    expect(exported.headers['content-disposition']).toContain(`allowance-mandate-${id}.json`);
    expect(exported.body.payments).toHaveLength(2);
    const stopped = await post(`/api/mandates/${id}/stop`, {}).expect(200);
    expect(stopped.body.status).toBe('stopped');
    const invalid = await post(`/api/mandates/${id}/payments`, { requestId: 'short', recipient: vendor.address, amount: '0.010000' }).expect(400);
    expect(invalid.body.code).toBe('INVALID_FIELDS');
    await agent.get('/api/mandates/00000000-0000-4000-8000-000000000000').expect(404);
  });
  it('rejects a recipient addition without a configured administrator key', async () => {
    const { post, vendor } = await setup();
    await post('/api/preflight', {});
    const created = await post('/api/mandates', mandateBody(vendor.address)).expect(201);
    const rejected = await post(`/api/mandates/${created.body.mandate.id}/recipients`, {
      address: '11111111111111111111111111111111',
      label: 'Someone',
      nonce: 'nonce_0000000000001',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      signer: vendor.address,
      signature: '1'.repeat(64),
    });
    expect(rejected.status).toBe(403);
    expect(rejected.body.code).toBe('APPROVAL_ADMIN_NOT_CONFIGURED');
  });
});
