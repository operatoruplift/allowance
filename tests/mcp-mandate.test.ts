import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport as ServerInMemoryTransport } from '@modelcontextprotocol/server';
import {
  generateKeyPair,
  generateKeyPairSigner,
  getAddressFromPublicKey,
  getBase58Decoder,
  getUtf8Encoder,
  signBytes,
} from '@solana/kit';
import { TOKEN_PROGRAM_ADDRESS, findAssociatedTokenPda } from '@solana-program/token';
import { PAYMENT_CHAINS } from '../shared/domain.js';
import { approvalMessage } from '../shared/mandate.js';
import { openDatabase } from '../server/db/index.js';
import { loadConfig } from '../server/config.js';
import { Ledger } from '../server/policy/ledger.js';
import { MandateLedger } from '../server/direct/ledger.js';
import { createDirectPaymentService } from '../server/direct/service.js';
import { createMandateGrant, revokeSessionMandateGrants } from '../server/direct/grants.js';
import { createAllowanceMcpServer } from '../server/mcp.js';
import { FakeChain } from './fixtures/direct-chain.js';

const closers: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});
const MINT = PAYMENT_CHAINS.devnet.mint;
const ata = async (owner: string) =>
  String((await findAssociatedTokenPda({ owner: owner as never, mint: MINT as never, tokenProgram: TOKEN_PROGRAM_ADDRESS }))[0]);

async function setup() {
  const payer = await generateKeyPairSigner();
  const vendor = await generateKeyPairSigner();
  const newcomer = await generateKeyPairSigner();
  const admin = await generateKeyPair();
  const adminAddress = await getAddressFromPublicKey(admin.publicKey);
  const chain = new FakeChain();
  chain.fund(await ata(payer.address), payer.address, 5_000_000n);
  chain.lamports.set(payer.address, 50_000_000n);
  const db = openDatabase(':memory:');
  closers.push(() => {
    if (db.open) db.close();
  });
  const config = loadConfig({
    MCP_ENABLED: 'true',
    PAYMENT_NETWORK: 'devnet',
    PAYMENT_RPC_URL: 'https://api.devnet.solana.com',
    DIRECT_PAYMENTS_ENABLED: 'true',
    DAILY_USDC_CEILING: '1000.000000',
    MERCHANT_RECIPIENT: '11111111111111111111111111111111',
    ADMIN_PUBLIC_KEY: adminAddress,
  });
  const ledger = new Ledger(db, config);
  const mandates = new MandateLedger(db, config, ledger);
  const direct = await createDirectPaymentService(config, { ledger, mandates }, { rpc: chain, signer: payer, sleep: async () => {}, confirmTimeoutMs: 5_000 });
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run('sess', Date.now() + 3600000, JSON.stringify({ operator: 'operator', issuedAt: Date.now() }));
  const mandate = mandates.create(
    { label: 'Vendors', perRequestCap: '0.020000', ceiling: '0.030000', expiresInMinutes: 60, recipients: [{ address: vendor.address, label: 'Vendor' }] },
    payer.address
  );
  const { token } = createMandateGrant(db, mandates, { mandateId: mandate.id, owner: 'operator', sessionId: 'sess', expiresAt: mandate.policy.expiresAt });
  const runtime = {
    config,
    db,
    ledger,
    mandates,
    direct,
    data: undefined,
    payments: { runPaidTool: async () => { throw new Error('not reached'); }, reconcile: async () => {}, readiness: async () => ({ ready: false, items: [], payer: null, balance: { usdc: null, sol: null } }), mountMerchant: () => {} },
    runner: null,
    close() {},
  } as never;
  const server = createAllowanceMcpServer(runtime, token);
  const [serverTransport, clientTransport] = ServerInMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'allowance-mandate-test', version: '1.0.0' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  closers.push(() => client.close(), () => server.close());
  const approve = async (address: string, label: string, over: Partial<{ nonce: string; expiresAt: string; signer: string; message: string }> = {}) => {
    const nonce = over.nonce ?? `nonce_${Math.random().toString(36).slice(2, 12).padEnd(12, '0')}`;
    const expiresAt = over.expiresAt ?? new Date(Date.now() + 10 * 60_000).toISOString();
    const message = over.message ?? approvalMessage({ mandateId: mandate.id, address, label, nonce, expiresAt });
    const signature = getBase58Decoder().decode(await signBytes(admin.privateKey, getUtf8Encoder().encode(message)));
    return { mandateId: mandate.id, address, label, nonce, expiresAt, signer: over.signer ?? adminAddress, signature };
  };
  return { client, chain, db, ledger, mandates, mandate, vendor, newcomer, payer, approve, adminAddress };
}
const payment = (mandateId: string, over: Record<string, unknown> = {}) => ({
  name: 'execute_guarded_payment',
  arguments: { mandateId, requestId: `req_${Math.random().toString(36).slice(2, 14).padEnd(12, '0')}`, amount: '0.010000', ...over },
});

describe('mandate tools on the MCP bridge', () => {
  it('describes the mandate and lists the five mandate tools with strict schemas', async () => {
    const { client, mandate, vendor } = await setup();
    const listed = await client.listTools();
    const names = listed.tools.map((tool) => tool.name);
    for (const name of ['get_mandate', 'execute_guarded_payment', 'list_direct_payments', 'add_recipient_to_allowlist', 'stop_mandate'])
      expect(names).toContain(name);
    const tool = listed.tools.find((item) => item.name === 'execute_guarded_payment');
    expect(tool?.inputSchema).toMatchObject({ type: 'object', additionalProperties: false, required: ['requestId', 'recipient', 'amount', 'mandateId'] });
    const status = await client.callTool({ name: 'get_mandate', arguments: { mandateId: mandate.id } });
    expect(status.isError).toBeFalsy();
    expect(status.structuredContent).toMatchObject({ mandateId: mandate.id, status: 'active', perRequestCap: '0.020000', ceiling: '0.030000', remaining: '0.030000', recipients: [{ address: vendor.address, addedBy: 'operator' }] });
  });
  it('blocks an unlisted recipient with a durable receipt and no chain traffic', async () => {
    const { client, chain, mandate, newcomer } = await setup();
    const blocked = await client.callTool(payment(mandate.id, { recipient: newcomer.address }));
    expect(blocked.isError).toBe(true);
    expect(blocked.structuredContent).toMatchObject({ code: 'POLICY_DENIED', verdict: 'BLOCKED', reasonCode: 'recipient-not-allowlisted', payment: { status: 'denied' } });
    expect(chain.calls).toHaveLength(0);
    const receipts = await client.callTool({ name: 'list_direct_payments', arguments: { mandateId: mandate.id } });
    expect(receipts.structuredContent).toMatchObject({ payments: [{ status: 'denied', verdict: 'BLOCKED', reasonCode: 'recipient-not-allowlisted' }] });
  });
  it('reports a reserved request as RESERVED until it has actually been submitted', async () => {
    const { client, chain, mandates, mandate, vendor } = await setup();
    const request = { requestId: 'reserved_request_0001', recipient: vendor.address, amount: '0.010000' };
    mandates.reserve(mandate.id, request, 'external-agent');
    const retry = await client.callTool(payment(mandate.id, request));
    expect(retry.structuredContent).toMatchObject({ verdict: 'RESERVED', payment: { status: 'reserved' } });
    const receipts = await client.callTool({ name: 'list_direct_payments', arguments: { mandateId: mandate.id } });
    expect(receipts.structuredContent).toMatchObject({ payments: [{ status: 'reserved', verdict: 'RESERVED' }] });
    expect(chain.calls).toHaveLength(0);
  });
  it('settles an allowlisted payment, links the explorer proof and counts it against the ceiling', async () => {
    const { client, chain, mandate, vendor } = await setup();
    const settled = await client.callTool(payment(mandate.id, { recipient: vendor.address, memo: 'order 7' }));
    expect(settled.isError).toBeFalsy();
    expect(settled.structuredContent).toMatchObject({ verdict: 'SETTLED', remaining: '0.020000', payment: { status: 'settled', chainVerified: true, source: 'external-agent', memo: 'order 7' } });
    const url = (settled.structuredContent as { explorerUrl: string }).explorerUrl;
    expect(url).toMatch(/^https:\/\/explorer\.solana\.com\/tx\/[1-9A-HJ-NP-Za-km-z]+\?cluster=devnet$/);
    expect(chain.methods('sendTransaction')).toHaveLength(1);
    const second = await client.callTool(payment(mandate.id, { recipient: vendor.address, amount: '0.020000' }));
    expect(second.structuredContent).toMatchObject({ verdict: 'SETTLED', remaining: '0.000000' });
    const third = await client.callTool(payment(mandate.id, { recipient: vendor.address, amount: '0.000001' }));
    expect(third.structuredContent).toMatchObject({ verdict: 'BLOCKED', reasonCode: 'mandate-ceiling' });
    expect(chain.methods('sendTransaction')).toHaveLength(2);
  });
  it('adds a recipient only with a valid single-use administrator signature', async () => {
    const { client, mandate, newcomer, approve, payer } = await setup();
    const forged = await approve(newcomer.address, 'New vendor', { signer: payer.address });
    const wrongSigner = await client.callTool({ name: 'add_recipient_to_allowlist', arguments: forged });
    expect(wrongSigner.structuredContent).toMatchObject({ code: 'APPROVAL_REJECTED', reasonCode: 'wrong-signer' });
    const tampered = await approve(newcomer.address, 'New vendor');
    const altered = await client.callTool({ name: 'add_recipient_to_allowlist', arguments: { ...tampered, label: 'Other label' } });
    expect(altered.structuredContent).toMatchObject({ code: 'APPROVAL_REJECTED', reasonCode: 'bad-signature' });
    const stale = await approve(newcomer.address, 'New vendor', { expiresAt: new Date(Date.now() - 1000).toISOString() });
    expect((await client.callTool({ name: 'add_recipient_to_allowlist', arguments: stale })).structuredContent).toMatchObject({ reasonCode: 'approval-expired' });
    const valid = await approve(newcomer.address, 'New vendor');
    const added = await client.callTool({ name: 'add_recipient_to_allowlist', arguments: valid });
    expect(added.isError).toBeFalsy();
    expect(added.structuredContent).toMatchObject({ recipients: [{ addedBy: 'operator' }, { address: newcomer.address, addedBy: 'admin-signature' }] });
    const replay = await client.callTool({ name: 'add_recipient_to_allowlist', arguments: valid });
    expect(replay.structuredContent).toMatchObject({ code: 'POLICY_DENIED' });
    const paid = await client.callTool(payment(mandate.id, { recipient: newcomer.address }));
    expect(paid.structuredContent).toMatchObject({ verdict: 'SETTLED', payment: { recipientLabel: 'New vendor' } });
  });
  it('refuses payments after the mandate is stopped or the authorizing session ends', async () => {
    const { client, db, mandate, vendor } = await setup();
    revokeSessionMandateGrants(db, 'sess');
    const revoked = await client.callTool(payment(mandate.id, { recipient: vendor.address }));
    expect(revoked.structuredContent).toMatchObject({ code: 'GRANT_REVOKED' });
    const fresh = await setup();
    const stopped = await fresh.client.callTool({ name: 'stop_mandate', arguments: { mandateId: fresh.mandate.id } });
    expect(stopped.structuredContent).toMatchObject({ status: 'stopped', grantRevoked: true });
    const after = await fresh.client.callTool(payment(fresh.mandate.id, { recipient: fresh.vendor.address }));
    expect(after.structuredContent).toMatchObject({ code: 'GRANT_REVOKED' });
    expect(fresh.chain.methods('sendTransaction')).toHaveLength(0);
  });
  it('shares the payer hold with x402 purchases so a stuck purchase blocks direct payments too', async () => {
    const { client, db, mandate, vendor, payer } = await setup();
    db.prepare("INSERT INTO runs(id,owner,wallet,task,status,policy,created_at,data_network) VALUES('run-1','operator',?,'t','running','{}','2026-09-28T11:00:00.000Z','devnet')").run(payer.address);
    db.prepare("INSERT INTO intents(id,run_id,request_hash,tool,amount,status,created_at,day,source,signed_identity) VALUES('intent-1','run-1','h1','wallet_snapshot',10000,'submitted','2026-09-28T11:00:00.000Z','2026-09-28','agent','{\"phase\":\"signed\"}')").run();
    const held = await client.callTool(payment(mandate.id, { recipient: vendor.address }));
    expect(held.structuredContent).toMatchObject({ verdict: 'BLOCKED', reasonCode: 'payer-held' });
  });
});
