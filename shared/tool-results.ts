import { z } from 'zod';
import {
  addressSchema,
  signatureSchema,
  type DataNetwork,
  type RunDTO,
  type ToolName,
} from './domain.js';

const unsigned = z
  .string()
  .regex(/^(0|[1-9]\d*)$/)
  .max(20)
  .refine(
    (value) =>
      /^(0|[1-9]\d*)$/.test(value) &&
      value.length <= 20 &&
      BigInt(value) <= 18_446_744_073_709_551_615n
  );
const signed = z
  .string()
  .regex(/^-?(0|[1-9]\d*)$/)
  .max(21);
const decimal = z
  .string()
  .regex(/^-?(0|[1-9]\d*)(\.\d+)?$/)
  .max(280);
const text = z.string().max(2048);
const cluster = z.enum(['devnet', 'mainnet-beta']);
const observation = {
  source: z.literal('Solana JSON-RPC'),
  commitment: z.literal('confirmed'),
  observedAt: z.iso.datetime(),
};
const limitations = z.array(text).min(1).max(8);
const instruction = z
  .object({
    index: z
      .string()
      .regex(/^\d+(\.\d+)?$/)
      .max(10),
    programId: addressSchema,
    type: z.enum(['sol-transfer', 'token-transfer', 'unsupported']),
    source: addressSchema.optional(),
    destination: addressSchema.optional(),
    amountBaseUnits: unsigned.optional(),
    amount: decimal.optional(),
    decimals: z.number().int().min(0).max(255).optional(),
    mint: addressSchema.optional(),
    description: text,
  })
  .strict();

export const walletSnapshotResultSchema = z
  .object({
    address: addressSchema,
    dataCluster: cluster,
    balanceLamports: unsigned,
    balanceSol: decimal,
    recentSignatures: z
      .array(
        z
          .object({
            signature: signatureSchema,
            slot: unsigned,
            blockTime: z.number().int().safe().nonnegative().nullable(),
            status: z.enum(['success', 'failed']),
            confirmationStatus: z.enum(['processed', 'confirmed', 'finalized']).nullable(),
          })
          .strict()
      )
      .max(8),
    historyState: z.enum(['empty', 'available']),
    provenance: z
      .object({ ...observation, balanceSlot: unsigned, historyLimit: z.literal(8) })
      .strict(),
    limitations,
  })
  .strict()
  .superRefine((value, context) => {
    if (!unsigned.safeParse(value.balanceLamports).success) return;
    const amount = BigInt(value.balanceLamports);
    const expected = `${amount / 1_000_000_000n}.${String(amount % 1_000_000_000n).padStart(9, '0')}`;
    if (
      value.balanceSol !== expected ||
      (value.historyState === 'empty') !== (value.recentSignatures.length === 0) ||
      new Set(value.recentSignatures.map((item) => item.signature)).size !==
        value.recentSignatures.length
    )
      context.addIssue({ code: 'custom', message: 'Snapshot facts are inconsistent.' });
  });

export const transactionExplainResultSchema = z
  .object({
    signature: signatureSchema,
    dataCluster: cluster,
    status: z.enum(['success', 'failed']),
    feeLamports: unsigned,
    feeSol: decimal,
    feePayer: addressSchema,
    instructions: z.array(instruction).max(256),
    nativeBalanceChanges: z
      .array(
        z
          .object({
            address: addressSchema,
            beforeLamports: unsigned,
            afterLamports: unsigned,
            deltaLamports: signed,
            deltaSol: decimal,
          })
          .strict()
      )
      .max(256),
    tokenBalanceChanges: z
      .array(
        z
          .object({
            account: addressSchema,
            owner: addressSchema.nullable(),
            mint: addressSchema,
            decimals: z.number().int().min(0).max(255),
            beforeBaseUnits: unsigned,
            afterBaseUnits: unsigned,
            deltaBaseUnits: signed,
            delta: decimal,
            coverage: z.enum(['post-only', 'pre-only', 'both']),
          })
          .strict()
      )
      .max(512),
    provenance: z
      .object({
        ...observation,
        slot: unsigned,
        blockTime: z.number().int().safe().nonnegative().nullable(),
        maxSupportedTransactionVersion: z.literal(0),
      })
      .strict(),
    limitations,
    tokenBalanceCoverage: z.enum(['unavailable-or-partial', 'available']),
  })
  .strict();

/** Only validated facts for the requested identity can become a delivered purchase. */
export function validateToolResult(
  tool: ToolName,
  raw: unknown,
  args: unknown,
  network?: DataNetwork
) {
  const result =
    tool === 'wallet_snapshot'
      ? walletSnapshotResultSchema.parse(raw)
      : transactionExplainResultSchema.parse(raw);
  const requested = args as { address?: string; signature?: string };
  if (
    ('address' in result
      ? result.address !== requested.address
      : result.signature !== requested.signature) ||
    (network !== undefined &&
      result.dataCluster !== (network === 'mainnet' ? 'mainnet-beta' : 'devnet'))
  )
    throw new Error('Tool result identity or data network differs from the frozen request.');
  return result;
}

export function snapshotIncludesSignature(
  run: Pick<RunDTO, 'purchases' | 'wallet' | 'dataNetwork'>,
  signature: string
) {
  return run.purchases.some((purchase) => {
    if (purchase.tool !== 'wallet_snapshot' || purchase.serviceOutcome !== 'delivered')
      return false;
    const parsed = walletSnapshotResultSchema.safeParse(purchase.result);
    return (
      parsed.success &&
      parsed.data.address === run.wallet &&
      parsed.data.dataCluster === (run.dataNetwork === 'mainnet' ? 'mainnet-beta' : 'devnet') &&
      parsed.data.recentSignatures.some((entry) => entry.signature === signature)
    );
  });
}
