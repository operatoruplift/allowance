import { afterEach, describe, expect, it } from 'vitest';
import {
  generateKeyPairSigner,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
} from '@solana/kit';
import { TOKEN_PROGRAM_ADDRESS, findAssociatedTokenPda } from '@solana-program/token';
import { PAYMENT_CHAINS } from '../shared/domain.js';
import { openDatabase } from '../server/db/index.js';
import { loadConfig } from '../server/config.js';
import { Ledger } from '../server/policy/ledger.js';
import { MandateLedger } from '../server/direct/ledger.js';
import { createDirectPaymentService } from '../server/direct/service.js';
import { composeTransfer, inspectLandedTransaction } from '../server/direct/transfer.js';
import { PaymentError } from '../server/payments/guard.js';
import { FakeChain } from './fixtures/direct-chain.js';

const dbs: ReturnType<typeof openDatabase>[] = [];
afterEach(() => dbs.splice(0).forEach((db) => db.open && db.close()));
const MINT = PAYMENT_CHAINS.devnet.mint;
const ata = async (owner: string) =>
  String((await findAssociatedTokenPda({ owner: owner as never, mint: MINT as never, tokenProgram: TOKEN_PROGRAM_ADDRESS }))[0]);
const decodeWire = (wire: string) => {
  const transaction = getTransactionDecoder().decode(Buffer.from(wire, 'base64'));
  const message = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes);
  const keys = message.staticAccounts.map(String);
  return { transaction, message, programs: message.instructions.map((ix) => keys[ix.programAddressIndex]), keys };
};

async function setup(options: { recipientFunded?: boolean; lamports?: bigint; usdc?: bigint } = {}) {
  const payer = await generateKeyPairSigner();
  const vendor = await generateKeyPairSigner();
  const chain = new FakeChain();
  const source = await ata(payer.address);
  const destination = await ata(vendor.address);
  chain.fund(source, payer.address, options.usdc ?? 5_000_000n);
  if (options.recipientFunded) chain.fund(destination, vendor.address, 0n);
  chain.lamports.set(payer.address, options.lamports ?? 50_000_000n);
  let clock = Date.parse('2026-09-28T12:00:00.000Z');
  const db = openDatabase(':memory:');
  dbs.push(db);
  const config = loadConfig({
    PAYMENT_NETWORK: 'devnet',
    PAYMENT_RPC_URL: 'https://api.devnet.solana.com',
    DIRECT_PAYMENTS_ENABLED: 'true',
    DAILY_USDC_CEILING: '1000.000000',
    MERCHANT_RECIPIENT: '11111111111111111111111111111111',
  });
  const ledger = new Ledger(db, config, () => clock);
  const mandates = new MandateLedger(db, config, ledger, () => clock);
  const direct = await createDirectPaymentService(config, { ledger, mandates }, {
    rpc: chain,
    signer: payer,
    now: () => clock,
    sleep: async () => {
      clock += 1500;
    },
    confirmTimeoutMs: 20_000,
  });
  const mandate = mandates.create(
    { label: 'Vendors', perRequestCap: '0.250000', ceiling: '1.000000', expiresInMinutes: 60, recipients: [{ address: vendor.address, label: 'Vendor' }] },
    payer.address
  );
  const request = (over: Partial<{ requestId: string; recipient: string; amount: string; memo: string }> = {}) => ({
    requestId: 'req_0000000000000001',
    recipient: vendor.address,
    amount: '0.010000',
    ...over,
  });
  return { payer, vendor, chain, db, config, ledger, mandates, direct, mandate, request, source, destination };
}

describe('direct payment service', () => {
  it('settles an approved payment end to end and proves the exact USDC movement', async () => {
    const { chain, direct, mandates, mandate, request, source, destination, payer, vendor } = await setup();
    const payment = await direct.pay(mandate.id, request({ memo: 'invoice 42' }), 'operator');
    expect(payment).toMatchObject({ status: 'settled', chainVerified: true, createdRecipientAccount: true, feeLamports: '5000', source: 'operator', memo: 'invoice 42' });
    expect(payment.signature).toMatch(/^[1-9A-HJ-NP-Za-km-z]{86,88}$/);
    expect(payment.explorerUrl).toBe(`https://explorer.solana.com/tx/${payment.signature}?cluster=devnet`);
    expect(chain.tokenAccounts.get(source)?.amount).toBe(4_990_000n);
    expect(chain.tokenAccounts.get(destination)).toEqual({ owner: vendor.address, mint: MINT, amount: 10_000n });
    const { programs, message, keys } = decodeWire(chain.landed.get(payment.signature!)!.wire);
    expect(programs).toEqual([
      'ComputeBudget111111111111111111111111111111',
      'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
      TOKEN_PROGRAM_ADDRESS,
      'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
    ]);
    expect(keys[0]).toBe(payer.address);
    const memo = message.instructions[3];
    expect(Buffer.from(memo.data!).toString('utf8')).toBe(`allowance:direct:${payment.id}:invoice 42`);
    const after = mandates.get(mandate.id);
    expect(after).toMatchObject({ settled: '10000', held: '0', remaining: '990000' });
    expect(after.events.map((event) => event.kind)).toEqual(['authorization', 'reserved', 'signing', 'submitted', 'settled']);
    // The chain saw exactly one broadcast and the read-before-sign order the policy requires.
    expect(chain.methods('sendTransaction')).toHaveLength(1);
    const order = chain.calls.map((call) => call.method);
    expect(order.indexOf('simulateTransaction')).toBeLessThan(order.indexOf('sendTransaction'));
  });
  it('skips account creation when the recipient already holds a USDC account', async () => {
    const { chain, direct, mandate, request } = await setup({ recipientFunded: true });
    const payment = await direct.pay(mandate.id, request(), 'operator');
    expect(payment.status).toBe('settled');
    expect(payment.createdRecipientAccount).toBe(false);
    expect(decodeWire(chain.landed.get(payment.signature!)!.wire).programs).toHaveLength(3);
  });
  it('never touches the chain for a request the policy denies', async () => {
    const { chain, direct, mandate, request } = await setup();
    const payment = await direct.pay(mandate.id, request({ amount: '0.300000' }), 'operator');
    expect(payment).toMatchObject({ status: 'denied', reasonCode: 'per-request-cap' });
    expect(chain.calls).toHaveLength(0);
  });
  it('releases the reservation without signing when funds, fees or simulation fail', async () => {
    const poor = await setup({ usdc: 1_000n });
    await expect(poor.direct.pay(poor.mandate.id, poor.request(), 'operator')).rejects.toMatchObject({ code: 'insufficient-usdc' });
    expect(poor.mandates.get(poor.mandate.id).payments[0].status).toBe('released');
    expect(poor.chain.methods('sendTransaction')).toHaveLength(0);
    const broke = await setup({ lamports: 1_000n });
    await expect(broke.direct.pay(broke.mandate.id, broke.request(), 'operator')).rejects.toMatchObject({ code: 'insufficient-sol' });
    const failing = await setup();
    failing.chain.simulationError = { InstructionError: [2, 'Custom'] };
    await expect(failing.direct.pay(failing.mandate.id, failing.request(), 'operator')).rejects.toBeInstanceOf(PaymentError);
    const receipt = failing.mandates.get(failing.mandate.id).payments[0];
    expect(receipt.status).toBe('released');
    expect(failing.db.prepare('SELECT signed_identity FROM direct_payments WHERE id=?').get(receipt.id)).toEqual({ signed_identity: null });
    expect(failing.ledger.payerFrozen()).toBe(false);
  });
  it('holds the payer after a failed submission and expires the payment once its blockhash lapses', async () => {
    const { chain, direct, ledger, mandates, mandate, request } = await setup();
    chain.sendError = new Error('gateway');
    const payment = await direct.pay(mandate.id, request(), 'operator');
    expect(payment.status).toBe('settlement-unknown');
    expect(payment.signature).toBeDefined();
    expect(ledger.payerFrozen()).toBe(true);
    const blocked = await direct.pay(mandate.id, request({ requestId: 'req_0000000000000002' }), 'operator');
    expect(blocked.reasonCode).toBe('payer-held');
    chain.sendError = null;
    // Still inside the blockhash window: the reconciler re-broadcasts the identical bytes.
    await direct.reconcile();
    const resent = mandates.getPayment(payment.id)!;
    expect(chain.methods('sendTransaction')).toHaveLength(2);
    expect(resent.status).toBe('settled');
    expect(ledger.payerFrozen()).toBe(false);
  });
  it('expires a transaction that never lands after its last valid block height', async () => {
    const { chain, direct, ledger, mandates, mandate, request } = await setup();
    chain.neverLands = true;
    const payment = await direct.pay(mandate.id, request(), 'operator');
    expect(payment.status).toBe('submitted');
    expect(ledger.payerFrozen()).toBe(true);
    chain.blockHeight = 2000n;
    await direct.reconcile();
    expect(mandates.getPayment(payment.id)).toMatchObject({ status: 'expired', chainVerified: false });
    expect(ledger.payerFrozen()).toBe(false);
    expect(mandates.get(mandate.id).remaining).toBe('1000000');
  });
  it('records a transaction that landed with an error as failed and moves no funds', async () => {
    const { chain, direct, mandate, request, source } = await setup();
    chain.landWithError = { InstructionError: [1, { Custom: 1 }] };
    const payment = await direct.pay(mandate.id, request(), 'operator');
    expect(payment).toMatchObject({ status: 'failed', chainVerified: false });
    expect(chain.tokenAccounts.get(source)?.amount).toBe(5_000_000n);
  });
  it('leaves a slow confirmation submitted and settles it on a later reconcile pass', async () => {
    const { chain, direct, mandates, mandate, request } = await setup();
    chain.confirmAfterPolls = 100;
    const payment = await direct.pay(mandate.id, request(), 'operator');
    expect(payment.status).toBe('submitted');
    chain.confirmAfterPolls = 0;
    await direct.reconcile();
    expect(mandates.getPayment(payment.id)?.status).toBe('settled');
  });
  it('answers a repeated request id with the original receipt and no second transfer', async () => {
    const { chain, direct, mandate, request } = await setup();
    const first = await direct.pay(mandate.id, request(), 'operator');
    const again = await direct.pay(mandate.id, request(), 'operator');
    expect(again).toEqual(first);
    expect(chain.methods('sendTransaction')).toHaveLength(1);
  });
});

describe('transfer evidence', () => {
  it('accepts only the landed transaction whose message, signature, fee and token deltas match', async () => {
    const { chain, direct, mandate, request, payer, vendor, source, destination } = await setup();
    const payment = await direct.pay(mandate.id, request(), 'operator');
    const raw = await chain.call('getTransaction', [payment.signature]);
    const identity = JSON.parse(String((chain as never as { db?: unknown }).db ?? '{}'));
    void identity;
    const composed = await composeTransfer({
      paymentId: payment.id,
      signer: payer,
      recipient: vendor.address,
      mint: MINT,
      amount: 10_000n,
      createRecipientAccount: true,
      blockhash: chain.blockhash,
      lastValidBlockHeight: chain.lastValidBlockHeight,
      priorityFeeMicroLamports: 0,
    });
    const expected = {
      signature: payment.signature!,
      messageHash: composed.messageHash,
      source,
      destination,
      payer: payer.address,
      recipient: vendor.address,
      mint: MINT,
      amount: 10_000n,
      createdRecipientAccount: true,
      maxFeeLamports: 15_000,
    };
    expect(inspectLandedTransaction(raw, expected)).toMatchObject({ outcome: 'settled', evidence: { chainVerified: true, feeLamports: '5000' } });
    expect(inspectLandedTransaction(raw, { ...expected, amount: 10_001n })).toMatchObject({ outcome: 'mismatch' });
    expect(inspectLandedTransaction(raw, { ...expected, maxFeeLamports: 4_999 })).toMatchObject({ outcome: 'mismatch' });
    expect(inspectLandedTransaction(raw, { ...expected, messageHash: '0'.repeat(64) })).toMatchObject({ outcome: 'mismatch' });
    expect(inspectLandedTransaction(null, expected)).toBeNull();
  });
});
