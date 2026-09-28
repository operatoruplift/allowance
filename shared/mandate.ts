import { z } from 'zod';
import {
  PAYMENT_CHAINS,
  addressSchema,
  parseMoney,
  signatureSchema,
  units,
  type PaymentChainId,
  type PaymentNetwork,
  type UsdcMint,
} from './domain.js';

/**
 * A mandate is the second kind of frozen spending authority: instead of buying
 * catalog tools over x402, an agent may move exact USDC amounts to recipients an
 * operator listed in advance. Every check here is pure; the ledger supplies the
 * totals and the transaction layer never sees a proposal the policy denied.
 */
export const MANDATE_VERSION = 1 as const;
export const MAX_MANDATE_RECIPIENTS = 20;
export const MAX_MANDATE_MINUTES = 24 * 60;
export const DIRECT_PAYMENT_STATUSES = [
  'denied',
  'reserved',
  'submitted',
  'settlement-unknown',
  'settled',
  'failed',
  'expired',
  'released',
] as const;
export type DirectPaymentStatus = (typeof DIRECT_PAYMENT_STATUSES)[number];
export const DIRECT_DENIAL_CODES = [
  'network-mismatch',
  'mint-mismatch',
  'invalid-amount',
  'self-payment',
  'recipient-not-allowlisted',
  'per-request-cap',
  'mandate-stopped',
  'expired',
  'payer-held',
  'mandate-ceiling',
  'daily-ceiling',
] as const;
export type DirectDenialCode = (typeof DIRECT_DENIAL_CODES)[number];
export const MANDATE_STATUSES = ['active', 'stopped', 'expired'] as const;
export type MandateStatus = (typeof MANDATE_STATUSES)[number];

export interface MandatePolicy {
  version: 1;
  network: PaymentChainId;
  mint: UsdcMint;
  payer: string;
  perRequestCap: string;
  ceiling: string;
  dailyCeiling: string;
  expiresAt: string;
}
export interface MandateRecipient {
  address: string;
  label: string;
  addedAt: string;
  addedBy: 'operator' | 'admin-signature';
  approvedBy?: string;
}
export interface DirectPaymentDTO {
  id: string;
  mandateId: string;
  requestId: string;
  recipient: string;
  recipientLabel?: string;
  amount: string;
  memo?: string;
  status: DirectPaymentStatus;
  reasonCode?: DirectDenialCode;
  reason?: string;
  createdAt: string;
  paymentNetwork: PaymentNetwork;
  mint: UsdcMint;
  signature?: string;
  chainVerified: boolean;
  slot?: string;
  feeLamports?: string;
  createdRecipientAccount?: boolean;
  proofObservedAt?: string;
  explorerUrl?: string;
  source: 'external-agent' | 'operator' | 'smoke';
}
export interface MandateEventDTO {
  id: number;
  at: string;
  kind: string;
  title: string;
  detail: string;
  source: 'agent' | 'policy' | 'system' | 'operator';
}
export interface MandateDTO {
  id: string;
  receiptVersion: 1;
  label: string;
  status: MandateStatus;
  policyHash: string;
  policy: MandatePolicy;
  paymentNetwork: PaymentNetwork;
  createdAt: string;
  stoppedAt?: string;
  recipients: MandateRecipient[];
  ceiling: string;
  settled: string;
  held: string;
  remaining: string;
  dailyCeiling: string;
  payments: DirectPaymentDTO[];
  events: MandateEventDTO[];
}

const money = (label: string) =>
  z.string().refine((value) => {
    try {
      return parseMoney(value) > 0;
    } catch {
      return false;
    }
  }, `Invalid ${label}.`);
const recipientLabel = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .regex(/^[\x20-\x7e]+$/, 'Use printable ASCII in labels.');
export const requestIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{16,128}$/, 'Use a stable request ID with 16–128 safe characters.');
export const createMandateSchema = z
  .object({
    label: z.string().trim().min(1).max(80),
    perRequestCap: money('per-request cap'),
    ceiling: money('ceiling'),
    expiresInMinutes: z.number().int().min(1).max(MAX_MANDATE_MINUTES),
    recipients: z
      .array(z.object({ address: addressSchema, label: recipientLabel }).strict())
      .min(1)
      .max(MAX_MANDATE_RECIPIENTS)
      .refine(
        (list) => new Set(list.map((item) => item.address)).size === list.length,
        'Recipients must be unique.'
      ),
  })
  .strict();
export type CreateMandateInput = z.infer<typeof createMandateSchema>;
export const directPaymentRequestSchema = z
  .object({
    requestId: requestIdSchema,
    recipient: addressSchema,
    amount: money('amount'),
    memo: z
      .string()
      .trim()
      .max(64)
      .regex(/^[\x20-\x7e]*$/, 'Use printable ASCII in memos.')
      .optional(),
  })
  .strict();
export type DirectPaymentRequest = z.infer<typeof directPaymentRequestSchema>;
export const recipientApprovalSchema = z
  .object({
    address: addressSchema,
    label: recipientLabel,
    nonce: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/, 'Use a 16–64 character nonce.'),
    expiresAt: z.iso.datetime(),
    signer: addressSchema,
    signature: signatureSchema,
  })
  .strict();
export type RecipientApproval = z.infer<typeof recipientApprovalSchema>;

/** The exact UTF-8 text an administrator signs to add one recipient to one mandate. */
export function approvalMessage(input: {
  mandateId: string;
  address: string;
  label: string;
  nonce: string;
  expiresAt: string;
}): string {
  return [
    'Allowance recipient approval v1',
    `mandate: ${input.mandateId}`,
    `recipient: ${input.address}`,
    `label: ${input.label}`,
    `nonce: ${input.nonce}`,
    `expires: ${input.expiresAt}`,
  ].join('\n');
}

export function explorerTransactionUrl(network: PaymentNetwork, signature: string): string {
  const url = new URL(`https://explorer.solana.com/tx/${signature}`);
  if (network === 'devnet') url.searchParams.set('cluster', 'devnet');
  return url.href;
}

export interface DirectConfigDTO {
  enabled: boolean;
  ready: boolean;
  network: PaymentNetwork;
  payer: string | null;
  adminPublicKey: string | null;
  items: { name: string; ready: boolean; detail: string }[];
  balance: { usdc: string | null; sol: string | null };
  dailyRemaining: string;
}

export interface MandateContext {
  policy: MandatePolicy;
  status: MandateStatus;
  recipients: readonly string[];
  settled: number;
  held: number;
  dailyUsed: number;
  dailyCeiling: number;
  payerFrozen: boolean;
  now: number;
}
export interface DirectPaymentProposal {
  recipient: string;
  amount: string;
  network: string;
  mint: string;
}
export type DirectDecision =
  | { allowed: true; code: 'allowed'; reason: string }
  | { allowed: false; code: DirectDenialCode; reason: string };

/**
 * Policy first, then the allowlist, then the caps. The order is what an agent
 * reads back in the denial, so it goes from "wrong asset" to "right asset,
 * right recipient, but not this much, not today".
 */
export function decideDirectPayment(
  context: MandateContext,
  proposal: DirectPaymentProposal
): DirectDecision {
  const { policy } = context;
  const deny = (code: DirectDenialCode, reason: string): DirectDecision => ({
    allowed: false,
    code,
    reason,
  });
  const chain = Object.values(PAYMENT_CHAINS).find((item) => item.network === policy.network);
  if (!chain || proposal.network !== policy.network)
    return deny('network-mismatch', 'Payment network does not match the frozen mandate.');
  if (policy.mint !== chain.mint || proposal.mint !== policy.mint)
    return deny('mint-mismatch', 'Asset mint does not match the mandate network’s native USDC.');
  let amount: number;
  try {
    amount = units(proposal.amount);
  } catch {
    return deny('invalid-amount', 'Amount must be a whole number of micro-USDC.');
  }
  if (amount <= 0) return deny('invalid-amount', 'Amount must be greater than zero.');
  if (proposal.recipient === policy.payer)
    return deny('self-payment', 'The payer cannot be its own recipient.');
  if (!context.recipients.includes(proposal.recipient))
    return deny('recipient-not-allowlisted', 'Recipient is not on the mandate allowlist.');
  if (amount > units(policy.perRequestCap))
    return deny('per-request-cap', 'Amount exceeds the per-request cap.');
  if (context.status === 'stopped')
    return deny('mandate-stopped', 'Mandate is no longer authorized to create payments.');
  if (context.status === 'expired' || context.now >= Date.parse(policy.expiresAt))
    return deny('expired', 'Mandate has expired.');
  if (context.payerFrozen)
    return deny(
      'payer-held',
      'A prior payment has an uncertain outcome; this payer is held for reconciliation.'
    );
  if (context.settled + context.held + amount > units(policy.ceiling))
    return deny('mandate-ceiling', 'Amount exceeds the remaining mandate ceiling.');
  if (
    context.dailyUsed + amount >
    Math.min(context.dailyCeiling, units(policy.dailyCeiling))
  )
    return deny('daily-ceiling', 'Operator daily ceiling exceeded.');
  return { allowed: true, code: 'allowed', reason: 'Within the frozen mandate and daily ceiling.' };
}
