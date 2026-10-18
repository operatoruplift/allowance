import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport as ServerInMemoryTransport } from '@modelcontextprotocol/server';
import { generateKeyPairSigner } from '@solana/kit';
import { TOKEN_PROGRAM_ADDRESS, findAssociatedTokenPda } from '@solana-program/token';
import { z } from 'zod';
import { createApp, type RuntimePayments } from '../server/app.js';
import { loadConfig } from '../server/config.js';
import { openDatabase } from '../server/db/index.js';
import { Ledger } from '../server/policy/ledger.js';
import { PolicyError } from '../server/policy/decision.js';
import { MandateLedger } from '../server/direct/ledger.js';
import { createDirectPaymentService } from '../server/direct/service.js';
import { createMandateGrant } from '../server/direct/grants.js';
import { createAllowanceMcpServer } from '../server/mcp.js';
import { AgentGrantError, createAgentGrant } from '../server/mcp/grants.js';
import {
  bridgeRuntimeConfig,
  deserializeBridgeError,
  httpBackend,
  serializeBridgeError,
} from '../server/mcp/backend.js';
import { PaymentError } from '../server/payments/guard.js';
import { PAYMENT_CHAINS } from '../shared/domain.js';
import { FakeChain } from './fixtures/direct-chain.js';

const TOKEN = 'bridge_token_0123456789abcdef0123456789abcdef';
const WALLET = '11111111111111111111111111111111';
const closers: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});
const ata = async (owner: string) =>
  String(
    (
      await findAssociatedTokenPda({
        owner: owner as never,
        mint: PAYMENT_CHAINS.devnet.mint as never,
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
      })
    )[0]
  );

/** The backend: a real app with a signer, a mandate and its one human grant. */
async function backend(env: NodeJS.ProcessEnv = {}) {
  const payer = await generateKeyPairSigner();
  const vendor = await generateKeyPairSigner();
  const chain = new FakeChain();
  chain.fund(await ata(payer.address), payer.address, 5_000_000n);
  chain.lamports.set(payer.address, 50_000_000n);
  const db = openDatabase(':memory:');
  closers.push(() => {
    if (db.open) db.close();
  });
  const config = loadConfig({
    MCP_ENABLED: 'true',
    MCP_BACKEND_TOKEN: TOKEN,
    PAYMENT_NETWORK: 'devnet',
    PAYMENT_RPC_URL: 'https://api.devnet.solana.com',
    DIRECT_PAYMENTS_ENABLED: 'true',
    DAILY_USDC_CEILING: '1000.000000',
    MERCHANT_RECIPIENT: WALLET,
    ...env,
  });
  const ledger = new Ledger(db, config);
  const mandates = new MandateLedger(db, config, ledger);
  const direct = await createDirectPaymentService(
    config,
    { ledger, mandates },
    { rpc: chain, signer: payer, sleep: async () => {}, confirmTimeoutMs: 5_000 }
  );
  const runPaidTool = vi.fn(
    async (_runId: string, _requestId: string, tool: string, args: Record<string, string>) => ({
      tool,
      args,
      result: 'paid-by-backend',
    })
  );
  const payments: RuntimePayments = {
    mountMerchant: () => {},
    readiness: async () => ({ ready: false, items: [], payer: null, balance: { usdc: null, sol: null } }),
    reconcile: async () => {},
    runPaidTool,
  };
  const app = createApp(config, db, ledger, payments, null, async () => ({}), { mandates, direct });
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(
    'sess',
    Date.now() + 3600000,
    JSON.stringify({ operator: 'operator', issuedAt: Date.now() })
  );
  const mandate = mandates.create(
    {
      label: 'Vendors',
      perRequestCap: '0.020000',
      ceiling: '0.030000',
      expiresInMinutes: 60,
      recipients: [{ address: vendor.address, label: 'Vendor' }],
    },
    payer.address
  );
  const { token: grant } = createMandateGrant(db, mandates, {
    mandateId: mandate.id,
    owner: 'operator',
    sessionId: 'sess',
    expiresAt: mandate.policy.expiresAt,
  });
  return { app, config, db, ledger, mandates, chain, payer, vendor, mandate, grant, runPaidTool };
}

async function listen(app: Parameters<typeof createServer>[1]): Promise<string> {
  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  closers.push(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      })
  );
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** A bridge runtime built the way main() builds it: same journal, no payer key source. */
async function bridgeRuntime(b: Awaited<ReturnType<typeof backend>>) {
  const { config, localSigner } = bridgeRuntimeConfig(b.config, {});
  expect(localSigner).toBe(false);
  const direct = await createDirectPaymentService(config, { ledger: b.ledger, mandates: b.mandates }, { rpc: b.chain });
  expect(direct.payer).toBeNull();
  expect(direct.enabled).toBe(false);
  return {
    config,
    db: b.db,
    ledger: b.ledger,
    mandates: b.mandates,
    direct,
    data: undefined,
    payments: {
      runPaidTool: async () => {
        throw new Error('The bridge process must never run a paid tool itself.');
      },
      reconcile: async () => {},
      readiness: async () => ({ ready: false, items: [], payer: null, balance: { usdc: null, sol: null } }),
      mountMerchant: () => {},
    },
    runner: null,
    close() {},
  } as never;
}

async function connect(runtime: never, grant: string, url: string, token = TOKEN) {
  const server = createAllowanceMcpServer(runtime, grant, httpBackend({ url, token }));
  const [serverTransport, clientTransport] = ServerInMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'allowance-bridge-test', version: '1.0.0' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  closers.push(() => client.close(), () => server.close());
  return client;
}

const payment = (mandateId: string, recipient: string, over: Record<string, unknown> = {}) => ({
  name: 'execute_guarded_payment',
  arguments: { mandateId, requestId: `req_${randomUUID().replaceAll('-', '')}`, recipient, amount: '0.010000', ...over },
});

describe('bridge endpoint authentication', () => {
  it('requires the shared token, needs no session or CSRF token, and never issues a cookie', async () => {
    const b = await backend();
    const path = `/api/bridge/mandates/${b.mandate.id}/payments`;
    const body = { requestId: 'bridge_request_000001', recipient: b.vendor.address, amount: '0.010000' };
    const missing = await request(b.app).post(path).send(body).expect(401);
    expect(missing.body).toMatchObject({ kind: 'unavailable', code: 'BRIDGE_UNAUTHORIZED' });
    expect(missing.headers['set-cookie']).toBeUndefined();
    await request(b.app).post(path).set('Authorization', `Bearer ${TOKEN.slice(0, -1)}x`).send(body).expect(401);
    const paid = await request(b.app).post(path).set('Authorization', `Bearer ${TOKEN}`).send(body).expect(200);
    expect(paid.body.payment).toMatchObject({ status: 'settled', chainVerified: true, source: 'external-agent' });
    expect(paid.headers['set-cookie']).toBeUndefined();
    expect(paid.headers['cache-control']).toBe('no-store');
    expect(b.chain.methods('sendTransaction')).toHaveLength(1);
  });
  it('stays off until MCP and the token are configured, and refuses proxied callers', async () => {
    const disabled = await backend({ MCP_ENABLED: 'false' });
    const off = await request(disabled.app)
      .post(`/api/bridge/mandates/${disabled.mandate.id}/payments`)
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({})
      .expect(503);
    expect(off.body.code).toBe('MCP_DISABLED');
    const untokened = await backend({ MCP_BACKEND_TOKEN: '' });
    const noToken = await request(untokened.app)
      .post(`/api/bridge/mandates/${untokened.mandate.id}/payments`)
      .set('Authorization', 'Bearer ')
      .send({})
      .expect(503);
    expect(noToken.body.code).toBe('BRIDGE_DISABLED');
    const proxied = await backend({ PROXY_HOPS: '1', NODE_ENV: 'production', APP_ORIGIN: 'https://console.example' });
    const forwarded = await request(proxied.app)
      .post(`/api/bridge/mandates/${proxied.mandate.id}/payments`)
      .set('Authorization', `Bearer ${TOKEN}`)
      .set('X-Forwarded-For', '203.0.113.9')
      .send({})
      .expect(403);
    expect(forwarded.body.code).toBe('BRIDGE_NOT_LOCAL');
    expect(() => loadConfig({ MCP_BACKEND_TOKEN: 'short' })).toThrow(/MCP_BACKEND_TOKEN/);
    expect(() => loadConfig({ MCP_BACKEND_URL: 'http://backend.example:4318' })).toThrow(/MCP_BACKEND_URL/);
    expect(loadConfig({ MCP_BACKEND_URL: 'https://console.example' }).mcpBackendUrl).toBe('https://console.example');
    expect(loadConfig({}).mcpBackendUrl).toBe('http://127.0.0.1:4318');
  });
  it('validates bodies, answers 404 for an unknown mandate and forwards x402 purchases to the paid-tool runner', async () => {
    const b = await backend();
    const auth = { Authorization: `Bearer ${TOKEN}` };
    const invalid = await request(b.app)
      .post(`/api/bridge/mandates/${b.mandate.id}/payments`)
      .set(auth)
      .send({ requestId: 'short', recipient: b.vendor.address, amount: '0.010000' })
      .expect(400);
    expect(invalid.body).toMatchObject({ kind: 'invalid', code: 'INVALID_FIELDS' });
    const unknown = await request(b.app)
      .post(`/api/bridge/mandates/${randomUUID()}/payments`)
      .set(auth)
      .send({ requestId: 'bridge_request_000002', recipient: b.vendor.address, amount: '0.010000' })
      .expect(404);
    expect(unknown.body).toMatchObject({ kind: 'invalid', code: 'NOT_FOUND' });
    const runId = randomUUID();
    const purchase = await request(b.app)
      .post(`/api/bridge/runs/${runId}/purchases`)
      .set(auth)
      .send({ requestId: 'bridge_purchase_0001', tool: 'wallet_snapshot', args: { address: WALLET } })
      .expect(200);
    expect(purchase.body.data).toMatchObject({ tool: 'wallet_snapshot', result: 'paid-by-backend' });
    expect(b.runPaidTool).toHaveBeenCalledWith(runId, 'bridge_purchase_0001', 'wallet_snapshot', { address: WALLET });
    await request(b.app)
      .post(`/api/bridge/runs/${runId}/purchases`)
      .set(auth)
      .send({ requestId: 'bridge_purchase_0002', tool: 'wallet_snapshot', args: { signature: 'x' } })
      .expect(400);
    expect(b.runPaidTool).toHaveBeenCalledOnce();
  });
});

describe('http backend client', () => {
  it('rebuilds the backend error classes from the envelope', () => {
    const roundTrip = (error: unknown) => {
      const { status, body } = serializeBridgeError(error);
      return { status, rebuilt: deserializeBridgeError(body) };
    };
    const payment = roundTrip(new PaymentError('insufficient-usdc', 'Not enough.', 'intent-1'));
    expect(payment.status).toBe(409);
    expect(payment.rebuilt).toBeInstanceOf(PaymentError);
    expect(payment.rebuilt).toMatchObject({ code: 'insufficient-usdc', message: 'Not enough.', intentId: 'intent-1' });
    expect(roundTrip(new PaymentError('disabled', 'Off.')).status).toBe(503);
    const policy = roundTrip(new PolicyError('Idempotency ID conflicts with a different request.'));
    expect(policy.status).toBe(409);
    expect(policy.rebuilt).toBeInstanceOf(PolicyError);
    const grant = roundTrip(new AgentGrantError('GRANT_REVOKED', 'Revoked.'));
    expect(grant.status).toBe(403);
    expect(grant.rebuilt).toBeInstanceOf(AgentGrantError);
    expect(grant.rebuilt).toMatchObject({ code: 'GRANT_REVOKED' });
    const invalid = roundTrip(z.string().safeParse(1).error);
    expect(invalid.status).toBe(400);
    expect(invalid.rebuilt).toMatchObject({ code: 'backend-rejected' });
    expect(roundTrip(new Error('Mandate not found.')).status).toBe(404);
    const unknown = roundTrip(new Error('database locked at /var/secret/path'));
    expect(unknown.status).toBe(503);
    expect(unknown.rebuilt).toMatchObject({ code: 'backend-unavailable' });
    expect(String((unknown.rebuilt as Error).message)).not.toContain('/var/secret');
  });
  it('refuses to pay without a token and names an unreachable or unreadable backend', async () => {
    const untokened = httpBackend({ url: 'http://127.0.0.1:4318', token: '' });
    await expect(untokened.payDirect(randomUUID(), { requestId: 'bridge_request_000003', recipient: WALLET, amount: '0.010000' })).rejects.toMatchObject({
      code: 'backend-unavailable',
      message: expect.stringMatching(/MCP_BACKEND_TOKEN/),
    });
    const down = httpBackend({
      url: 'http://127.0.0.1:4318',
      token: TOKEN,
      fetch: async () => {
        throw new Error('ECONNREFUSED');
      },
    });
    await expect(down.runPaidTool(randomUUID(), 'bridge_purchase_0003', 'wallet_snapshot', { address: WALLET })).rejects.toMatchObject({
      code: 'backend-unavailable',
      message: expect.stringMatching(/did not answer/),
    });
    const garbled = httpBackend({
      url: 'http://127.0.0.1:4318',
      token: TOKEN,
      fetch: async () => new Response('<html>nope</html>', { status: 500 }),
    });
    await expect(garbled.payDirect(randomUUID(), { requestId: 'bridge_request_000004', recipient: WALLET, amount: '0.010000' })).rejects.toMatchObject({
      code: 'backend-unavailable',
      message: expect.stringMatching(/HTTP 500/),
    });
  });
});

describe('bridge without a payer key', () => {
  it('strips both payer key sources unless the operator opts into a local signer', () => {
    const config = { ...loadConfig({}), payerSecretFile: 'secrets/payer.json', payerSecretJson: '[1,2,3]' };
    expect(bridgeRuntimeConfig(config, {})).toMatchObject({
      localSigner: false,
      config: { payerSecretFile: '', payerSecretJson: '' },
    });
    expect(bridgeRuntimeConfig(config, { ALLOWANCE_MCP_LOCAL_SIGNER: '1' })).toMatchObject({
      localSigner: true,
      config: { payerSecretFile: 'secrets/payer.json', payerSecretJson: '[1,2,3]' },
    });
    expect(config.payerSecretFile).toBe('secrets/payer.json');
  });
  it('settles a guarded payment on the backend while the bridge holds no signer', async () => {
    const b = await backend();
    const url = await listen(b.app);
    const client = await connect(await bridgeRuntime(b), b.grant, url);
    const settled = await client.callTool(payment(b.mandate.id, b.vendor.address, { memo: 'order 9' }));
    expect(settled.isError).toBeFalsy();
    expect(settled.structuredContent).toMatchObject({
      verdict: 'SETTLED',
      remaining: '0.020000',
      payment: { status: 'settled', chainVerified: true, source: 'external-agent', memo: 'order 9' },
    });
    expect(b.chain.methods('sendTransaction')).toHaveLength(1);
    const blocked = await client.callTool(payment(b.mandate.id, WALLET));
    expect(blocked.isError).toBe(true);
    expect(blocked.structuredContent).toMatchObject({
      code: 'POLICY_DENIED',
      verdict: 'BLOCKED',
      reasonCode: 'recipient-not-allowlisted',
      payment: { status: 'denied' },
    });
    const first = payment(b.mandate.id, b.vendor.address);
    await client.callTool(first);
    const conflict = await client.callTool({ ...first, arguments: { ...first.arguments, amount: '0.020000' } });
    expect(conflict.structuredContent).toMatchObject({ code: 'POLICY_DENIED', verdict: 'BLOCKED' });
    expect(b.chain.methods('sendTransaction')).toHaveLength(2);
  });
  it('returns the released receipt when the backend refuses to sign', async () => {
    const b = await backend();
    const source = await ata(b.payer.address);
    b.chain.fund(source, b.payer.address, 1_000n);
    const url = await listen(b.app);
    const client = await connect(await bridgeRuntime(b), b.grant, url);
    const attempt = payment(b.mandate.id, b.vendor.address);
    const refused = await client.callTool(attempt);
    expect(refused.isError).toBe(true);
    expect(refused.structuredContent).toMatchObject({
      code: 'PAYMENT_FAILED',
      verdict: 'NOT_SIGNED',
      payment: { id: attempt.arguments.requestId, status: 'released' },
    });
    expect(b.chain.methods('sendTransaction')).toHaveLength(0);
  });
  it('answers PAYMENT_UNAVAILABLE with the reason when no backend token is configured', async () => {
    const b = await backend();
    const url = await listen(b.app);
    const client = await connect(await bridgeRuntime(b), b.grant, url, '');
    const unavailable = await client.callTool(payment(b.mandate.id, b.vendor.address));
    expect(unavailable.isError).toBe(true);
    expect(unavailable.structuredContent).toMatchObject({
      code: 'PAYMENT_UNAVAILABLE',
      message: expect.stringMatching(/MCP_BACKEND_TOKEN/),
      verdict: 'NOT_SIGNED',
    });
    expect(b.chain.methods('sendTransaction')).toHaveLength(0);
    const status = await client.callTool({ name: 'get_mandate', arguments: { mandateId: b.mandate.id } });
    expect(status.isError).toBeFalsy();
  });
  it('forwards x402 purchases to the backend instead of running them in the bridge', async () => {
    const b = await backend();
    const run = b.ledger.createRun(
      {
        wallet: WALLET,
        task: 'Explain this wallet activity.',
        allowance: '0.04',
        perRequestCap: '0.02',
        expiresInMinutes: 10,
        allowedTools: ['wallet_snapshot', 'transaction_explain'],
      },
      'operator',
      'external'
    );
    b.ledger.setStatus(run.id, 'running');
    const { token } = createAgentGrant(b.db, b.ledger, { runId: run.id, owner: 'operator', sessionId: 'sess', expiresAt: run.policy.expiresAt });
    const url = await listen(b.app);
    const client = await connect(await bridgeRuntime(b), token, url);
    const result = await client.callTool({ name: 'wallet_snapshot', arguments: { runId: run.id, requestId: 'bridge_purchase_0010' } });
    // The stand-in runner writes no receipt, so the bridge reports exactly that after the backend answered.
    expect(result.structuredContent).toMatchObject({ code: 'RECEIPT_MISSING' });
    expect(b.runPaidTool).toHaveBeenCalledWith(run.id, 'bridge_purchase_0010', 'wallet_snapshot', { address: WALLET });
  });
});
