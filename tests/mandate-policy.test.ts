import { describe, expect, it } from 'vitest';
import { PAYMENT_CHAINS } from '../shared/domain.js';
import {
  approvalMessage,
  createMandateSchema,
  decideDirectPayment,
  directPaymentRequestSchema,
  explorerTransactionUrl,
  recipientApprovalSchema,
  type MandateContext,
} from '../shared/mandate.js';

const payer = 'GjwcWFQYzemBtpUoN5fMAP2FZviTtMRWCmrppGuTthJS';
const merchant = 'C6vMeD9xvzWfEqnx7RXosDGWm8VZk5wyV2c8LqrF3Chz';
const stranger = '11111111111111111111111111111111';
const context = (over: Partial<MandateContext> = {}): MandateContext => ({
  policy: {
    version: 1,
    network: PAYMENT_CHAINS.devnet.network,
    mint: PAYMENT_CHAINS.devnet.mint,
    payer,
    perRequestCap: '250000000',
    ceiling: '1000000000',
    dailyCeiling: '1000000000',
    expiresAt: '2026-10-01T00:00:00.000Z',
  },
  status: 'active',
  recipients: [merchant],
  settled: 0,
  held: 0,
  dailyUsed: 0,
  dailyCeiling: 1_000_000_000,
  payerFrozen: false,
  now: Date.parse('2026-09-28T12:00:00.000Z'),
  ...over,
});
const proposal = (over: Partial<{ recipient: string; amount: string; network: string; mint: string }> = {}) => ({
  recipient: merchant,
  amount: '5000000',
  network: PAYMENT_CHAINS.devnet.network,
  mint: PAYMENT_CHAINS.devnet.mint,
  ...over,
});

describe('direct payment policy', () => {
  it('allows an exact amount to an allowlisted recipient within every cap', () => {
    expect(decideDirectPayment(context(), proposal())).toEqual({
      allowed: true,
      code: 'allowed',
      reason: 'Within the frozen mandate and daily ceiling.',
    });
  });
  it.each([
    ['network-mismatch', {}, { network: PAYMENT_CHAINS.mainnet.network }],
    ['mint-mismatch', {}, { mint: PAYMENT_CHAINS.mainnet.mint }],
    ['invalid-amount', {}, { amount: '1.5' }],
    ['invalid-amount', {}, { amount: '0' }],
    ['self-payment', { recipients: [payer] }, { recipient: payer }],
    ['recipient-not-allowlisted', {}, { recipient: stranger }],
    ['per-request-cap', {}, { amount: '250000001' }],
    ['mandate-stopped', { status: 'stopped' as const }, {}],
    ['expired', { now: Date.parse('2026-10-01T00:00:00.000Z') }, {}],
    ['expired', { status: 'expired' as const }, {}],
    ['payer-held', { payerFrozen: true }, {}],
    ['mandate-ceiling', { settled: 900_000_000, held: 96_000_000 }, {}],
    ['daily-ceiling', { dailyUsed: 999_000_000 }, { amount: '2000000' }],
  ] as const)('denies with %s', (code, contextChanges, proposalChanges) => {
    const decision = decideDirectPayment(context(contextChanges), proposal(proposalChanges));
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe(code);
  });
  it('checks the allowlist before any cap, so an agent learns the recipient problem first', () => {
    const decision = decideDirectPayment(context({ payerFrozen: true }), proposal({ recipient: stranger, amount: '999999999999' }));
    expect(decision.code).toBe('recipient-not-allowlisted');
  });
  it('bounds the daily total by the smaller of the operator ceiling and the frozen policy ceiling', () => {
    expect(decideDirectPayment(context({ dailyCeiling: 4_000_000 }), proposal()).code).toBe('daily-ceiling');
    expect(decideDirectPayment(context({ dailyCeiling: 5_000_000 }), proposal()).allowed).toBe(true);
  });
});

describe('mandate request contracts', () => {
  it('accepts a bounded mandate and refuses duplicates, non-ASCII labels and long expiries', () => {
    const valid = { label: 'Vendors', perRequestCap: '0.25', ceiling: '1', expiresInMinutes: 60, recipients: [{ address: merchant, label: 'Data vendor' }] };
    expect(createMandateSchema.safeParse(valid).success).toBe(true);
    expect(createMandateSchema.safeParse({ ...valid, recipients: [valid.recipients[0], valid.recipients[0]] }).success).toBe(false);
    expect(createMandateSchema.safeParse({ ...valid, recipients: [{ address: merchant, label: 'Ünïcode' }] }).success).toBe(false);
    expect(createMandateSchema.safeParse({ ...valid, expiresInMinutes: 24 * 60 + 1 }).success).toBe(false);
    expect(createMandateSchema.safeParse({ ...valid, ceiling: '0' }).success).toBe(false);
    expect(createMandateSchema.safeParse({ ...valid, extra: true }).success).toBe(false);
  });
  it('requires a stable request id and a positive six-decimal amount for a payment', () => {
    const valid = { requestId: 'req_0000000000000001', recipient: merchant, amount: '0.010000' };
    expect(directPaymentRequestSchema.safeParse(valid).success).toBe(true);
    expect(directPaymentRequestSchema.safeParse({ ...valid, requestId: 'short' }).success).toBe(false);
    expect(directPaymentRequestSchema.safeParse({ ...valid, amount: '0.0000001' }).success).toBe(false);
    expect(directPaymentRequestSchema.safeParse({ ...valid, amount: '-1' }).success).toBe(false);
    expect(directPaymentRequestSchema.safeParse({ ...valid, memo: 'x'.repeat(65) }).success).toBe(false);
  });
  it('binds an approval message to one mandate, recipient, label, nonce and expiry', () => {
    const message = approvalMessage({ mandateId: 'm-1', address: merchant, label: 'Vendor', nonce: 'nonce_0000000000001', expiresAt: '2026-09-28T13:00:00.000Z' });
    expect(message.split('\n')).toEqual([
      'Allowance recipient approval v1',
      'mandate: m-1',
      `recipient: ${merchant}`,
      'label: Vendor',
      'nonce: nonce_0000000000001',
      'expires: 2026-09-28T13:00:00.000Z',
    ]);
    expect(recipientApprovalSchema.safeParse({ address: merchant, label: 'Vendor', nonce: 'nonce_0000000000001', expiresAt: '2026-09-28T13:00:00.000Z', signer: payer, signature: '1'.repeat(87) }).success).toBe(false);
  });
  it('links devnet receipts to the devnet explorer and mainnet receipts without a cluster flag', () => {
    expect(explorerTransactionUrl('devnet', 'sig')).toBe('https://explorer.solana.com/tx/sig?cluster=devnet');
    expect(explorerTransactionUrl('mainnet', 'sig')).toBe('https://explorer.solana.com/tx/sig');
  });
});
