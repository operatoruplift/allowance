import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../server/db/index.js';
import { loadConfig } from '../server/config.js';
import { Ledger } from '../server/policy/ledger.js';
import { MandateLedger } from '../server/direct/ledger.js';
import { createMandateGrant, revokeSessionMandateGrants } from '../server/direct/grants.js';
import { PolicyError } from '../server/policy/decision.js';

const payer = 'GjwcWFQYzemBtpUoN5fMAP2FZviTtMRWCmrppGuTthJS';
const vendor = 'C6vMeD9xvzWfEqnx7RXosDGWm8VZk5wyV2c8LqrF3Chz';
const other = 'DRpbCBMxVnDK7maPM5tGv6MvB3v1sRMC86PZ8okm21hy';
const dbs: ReturnType<typeof openDatabase>[] = [];
afterEach(() => dbs.splice(0).forEach((db) => db.open && db.close()));

function setup(environment: NodeJS.ProcessEnv = {}, start = Date.parse('2026-09-28T12:00:00.000Z')) {
  let now = start;
  const db = openDatabase(':memory:');
  dbs.push(db);
  const config = loadConfig({
    PAYMENT_NETWORK: 'devnet',
    PAYMENT_RPC_URL: 'https://api.devnet.solana.com',
    DIRECT_PAYMENTS_ENABLED: 'true',
    DAILY_USDC_CEILING: '1000.000000',
    MERCHANT_RECIPIENT: '11111111111111111111111111111111',
    ...environment,
  });
  const ledger = new Ledger(db, config, () => now);
  const mandates = new MandateLedger(db, config, ledger, () => now);
  const input = {
    label: 'Vendors',
    perRequestCap: '0.250000',
    ceiling: '1.000000',
    expiresInMinutes: 60,
    recipients: [{ address: vendor, label: 'Data vendor' }],
  };
  return { db, config, ledger, mandates, input, now: () => now, advance: (ms: number) => (now += ms) };
}
const request = (over: Partial<{ requestId: string; recipient: string; amount: string; memo: string }> = {}) => ({
  requestId: 'req_0000000000000001',
  recipient: vendor,
  amount: '0.010000',
  ...over,
});

describe('mandate ledger', () => {
  it('freezes a mandate with the payer, network, caps and recipients, and reports remaining budget', () => {
    const { mandates, input } = setup();
    const mandate = mandates.create(input, payer);
    expect(mandate).toMatchObject({
      status: 'active',
      paymentNetwork: 'devnet',
      policy: { version: 1, payer, perRequestCap: '250000', ceiling: '1000000', dailyCeiling: '1000000000' },
      ceiling: '1000000',
      settled: '0',
      held: '0',
      remaining: '1000000',
      recipients: [{ address: vendor, label: 'Data vendor', addedBy: 'operator' }],
    });
    expect(mandate.events.map((event) => event.kind)).toEqual(['authorization']);
    expect(mandate.policyHash).toMatch(/^[0-9a-f]{64}$/);
  });
  it('refuses caps above the ceiling, ceilings above the daily ceiling, and the payer as a recipient', () => {
    const { mandates, input } = setup();
    expect(() => mandates.create({ ...input, perRequestCap: '2' }, payer)).toThrow(PolicyError);
    expect(() => mandates.create({ ...input, ceiling: '1001' }, payer)).toThrow(/daily ceiling/);
    expect(() => mandates.create({ ...input, recipients: [{ address: payer, label: 'me' }] }, payer)).toThrow(/payer cannot/);
  });
  it('records denials as durable receipts and reservations as held funds', () => {
    const { mandates, input } = setup();
    const mandate = mandates.create(input, payer);
    const denied = mandates.reserve(mandate.id, request({ recipient: other }), 'operator');
    expect(denied.created).toBe(true);
    expect(denied.payment).toMatchObject({ status: 'denied', reasonCode: 'recipient-not-allowlisted', source: 'operator' });
    const reserved = mandates.reserve(mandate.id, request({ requestId: 'req_0000000000000002' }), 'operator');
    expect(reserved.payment.status).toBe('reserved');
    const after = mandates.get(mandate.id);
    expect(after.held).toBe('10000');
    expect(after.remaining).toBe('990000');
    expect(after.payments).toHaveLength(2);
    expect(after.events.map((event) => event.kind)).toEqual(['authorization', 'denied', 'reserved']);
  });
  it('treats a repeated request id as the same payment and a reused id with new terms as a conflict', () => {
    const { mandates, input } = setup();
    const mandate = mandates.create(input, payer);
    const first = mandates.reserve(mandate.id, request(), 'operator');
    const again = mandates.reserve(mandate.id, request(), 'operator');
    expect(again.created).toBe(false);
    expect(again.payment.id).toBe(first.payment.id);
    expect(() => mandates.reserve(mandate.id, request({ amount: '0.020000' }), 'operator')).toThrow(/Idempotency/);
    expect(mandates.get(mandate.id).held).toBe('10000');
  });
  it('shares the daily ceiling and the payer hold with x402 purchases in both directions', () => {
    const { db, ledger, mandates, input } = setup({ DAILY_USDC_CEILING: '0.050000' });
    const mandate = mandates.create({ ...input, ceiling: '0.050000', perRequestCap: '0.040000' }, payer);
    db.prepare("INSERT INTO runs(id,owner,wallet,task,status,policy,created_at,data_network) VALUES('run-1','operator',?,'t','running','{}','2026-09-28T11:00:00.000Z','devnet')").run(payer);
    db.prepare("INSERT INTO intents(id,run_id,request_hash,tool,amount,status,created_at,day,source) VALUES('intent-1','run-1','h1','wallet_snapshot',30000,'settled','2026-09-28T11:00:00.000Z','2026-09-28','agent')").run();
    expect(ledger.dailyUsed()).toBe(30000);
    const denied = mandates.reserve(mandate.id, request({ amount: '0.030000' }), 'operator');
    expect(denied.payment).toMatchObject({ status: 'denied', reasonCode: 'daily-ceiling' });
    const allowed = mandates.reserve(mandate.id, request({ requestId: 'req_0000000000000002', amount: '0.020000' }), 'operator');
    expect(allowed.payment.status).toBe('reserved');
    // The direct reservation now counts toward what x402 may spend today.
    expect(ledger.dailyUsed()).toBe(50000);
    db.prepare("UPDATE intents SET status='submitted',signed_identity='{\"phase\":\"signed\"}' WHERE id='intent-1'").run();
    expect(ledger.payerFrozen()).toBe(true);
    const held = mandates.reserve(mandate.id, request({ requestId: 'req_0000000000000003', amount: '0.000001' }), 'operator');
    expect(held.payment.reasonCode).toBe('payer-held');
  });
  it('holds the payer for both rails once a direct payment has entered signing', () => {
    const { ledger, mandates, input } = setup();
    const mandate = mandates.create(input, payer);
    const { payment } = mandates.reserve(mandate.id, request(), 'operator');
    expect(ledger.payerFrozen()).toBe(false);
    mandates.markSigning(payment.id, { messageHash: 'm', blockhash: 'b', lastValidBlockHeight: '10', payer, source: 's', destination: 'd', createRecipientAccount: false });
    expect(ledger.payerFrozen()).toBe(true);
    expect(ledger.payerFrozen(payment.id)).toBe(false);
    expect(() => mandates.markSigning(payment.id, { messageHash: 'm', blockhash: 'b', lastValidBlockHeight: '10', payer, source: 's', destination: 'd', createRecipientAccount: false })).toThrow(/another signature|already claimed/);
  });
  it('rechecks the human grant inside the signing claim after the session is revoked', () => {
    // Grant issuance checks the session on the wall clock, so this ledger runs on it too.
    const { db, mandates, input, now } = setup({}, Date.now());
    const mandate = mandates.create(input, payer);
    db.prepare('INSERT INTO sessions VALUES(?,?,?)').run('sess', now() + 3600000, JSON.stringify({ operator: 'operator', issuedAt: now() }));
    createMandateGrant(db, mandates, { mandateId: mandate.id, owner: 'operator', sessionId: 'sess', expiresAt: mandate.policy.expiresAt });
    const { payment } = mandates.reserve(mandate.id, request(), 'external-agent');
    revokeSessionMandateGrants(db, 'sess');
    expect(() => mandates.markSigning(payment.id, { messageHash: 'm', blockhash: 'b', lastValidBlockHeight: '10', payer, source: 's', destination: 'd', createRecipientAccount: false })).toThrow(/active human authorization/);
    expect(db.prepare('SELECT signed_identity FROM direct_payments WHERE id=?').get(payment.id)).toEqual({ signed_identity: null });
  });
  it('stops a mandate, releases unsigned reservations and keeps signed ones held', () => {
    const { mandates, input } = setup();
    const mandate = mandates.create(input, payer);
    const unsigned = mandates.reserve(mandate.id, request(), 'operator').payment;
    const signed = mandates.reserve(mandate.id, request({ requestId: 'req_0000000000000002' }), 'operator').payment;
    mandates.markSigning(signed.id, { messageHash: 'm', blockhash: 'b', lastValidBlockHeight: '10', payer, source: 's', destination: 'd', createRecipientAccount: false });
    const stopped = mandates.stop(mandate.id);
    expect(stopped.status).toBe('stopped');
    expect(stopped.payments.find((p) => p.id === unsigned.id)?.status).toBe('released');
    expect(stopped.payments.find((p) => p.id === signed.id)?.status).toBe('reserved');
    expect(mandates.reserve(mandate.id, request({ requestId: 'req_0000000000000003' }), 'operator').payment.reasonCode).toBe('mandate-stopped');
  });
  it('expires by its own clock and recovers restart states like the x402 ledger', () => {
    const { mandates, input, advance } = setup();
    const mandate = mandates.create(input, payer);
    const unsigned = mandates.reserve(mandate.id, request(), 'operator').payment;
    const signed = mandates.reserve(mandate.id, request({ requestId: 'req_0000000000000002' }), 'operator').payment;
    mandates.markSigning(signed.id, { messageHash: 'm', blockhash: 'b', lastValidBlockHeight: '10', payer, source: 's', destination: 'd', createRecipientAccount: false });
    mandates.recoverStartup();
    expect(mandates.getPayment(unsigned.id)?.status).toBe('released');
    expect(mandates.getPayment(signed.id)?.status).toBe('settlement-unknown');
    advance(61 * 60 * 1000);
    expect(mandates.get(mandate.id).status).toBe('expired');
    expect(mandates.reserve(mandate.id, request({ requestId: 'req_0000000000000003' }), 'operator').payment.reasonCode).toBe('expired');
  });
});
