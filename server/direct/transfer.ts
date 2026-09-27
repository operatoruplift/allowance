import { z } from 'zod';
import {
  address,
  appendTransactionMessageInstructions,
  blockhash,
  compileTransaction,
  createTransactionMessage,
  getBase58Decoder,
  getBase64Decoder,
  getBase64EncodedWireTransaction,
  getCompiledTransactionMessageDecoder,
  getSignatureFromTransaction,
  getTransactionDecoder,
  getUtf8Encoder,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Instruction,
  type KeyPairSigner,
} from '@solana/kit';
import {
  TOKEN_PROGRAM_ADDRESS,
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstructionAsync,
  getTransferCheckedInstruction,
} from '@solana-program/token';
import {
  getSetComputeUnitLimitInstruction,
  getSetComputeUnitPriceInstruction,
} from '@solana-program/compute-budget';
import type { PaymentNetwork } from '../../shared/domain.js';
import { MEMO_PROGRAM, PaymentError, sha256 } from '../payments/guard.js';

/** The bounded JSON-RPC surface the direct rail needs; `PaymentRpc` provides it. */
export interface DirectRpc {
  readonly network: PaymentNetwork;
  call(method: string, params: unknown[]): Promise<unknown>;
  assertNetwork(): Promise<void>;
}

export const DIRECT_MEMO_PREFIX = 'allowance:direct:';
const COMPUTE_UNITS_TRANSFER = 40_000;
const COMPUTE_UNITS_WITH_ACCOUNT = 90_000;
/** Rent for one associated token account plus headroom; checked against the payer's SOL. */
export const ACCOUNT_CREATION_LAMPORTS = 2_100_000n;

const tokenAccountSchema = z.object({
  owner: z.string(),
  data: z.object({
    parsed: z.object({
      type: z.literal('account'),
      info: z.object({
        mint: z.string(),
        owner: z.string(),
        state: z.string(),
        tokenAmount: z.object({ amount: z.string().regex(/^\d+$/), decimals: z.literal(6) }),
      }),
    }),
  }),
});

export interface TransferPreconditions {
  source: string;
  destination: string;
  recipientAccountExists: boolean;
  payerUsdc: bigint;
  payerLamports: bigint;
  blockhash: string;
  lastValidBlockHeight: bigint;
}

/** Everything the policy layer needs to know before any signature: accounts, balances and a lifetime. */
export async function readTransferPreconditions(
  rpc: DirectRpc,
  payer: string,
  recipient: string,
  mint: string
): Promise<TransferPreconditions> {
  await rpc.assertNetwork();
  const [[source], [destination]] = await Promise.all([
    findAssociatedTokenPda({ owner: address(payer), mint: address(mint), tokenProgram: TOKEN_PROGRAM_ADDRESS }),
    findAssociatedTokenPda({ owner: address(recipient), mint: address(mint), tokenProgram: TOKEN_PROGRAM_ADDRESS }),
  ]);
  const [sourceRaw, destinationRaw, balanceRaw, blockhashRaw] = await Promise.all([
    rpc.call('getAccountInfo', [source, { encoding: 'jsonParsed', commitment: 'confirmed' }]),
    rpc.call('getAccountInfo', [destination, { encoding: 'jsonParsed', commitment: 'confirmed' }]),
    rpc.call('getBalance', [payer, { commitment: 'confirmed' }]),
    rpc.call('getLatestBlockhash', [{ commitment: 'confirmed' }]),
  ]);
  const sourceValue = z.object({ value: z.unknown().nullable() }).parse(sourceRaw).value;
  if (sourceValue === null)
    throw new PaymentError('payer-account', 'The payer has no USDC associated token account.');
  const sourceAccount = tokenAccountSchema.parse(sourceValue);
  if (
    sourceAccount.owner !== TOKEN_PROGRAM_ADDRESS ||
    sourceAccount.data.parsed.info.mint !== mint ||
    sourceAccount.data.parsed.info.owner !== payer ||
    sourceAccount.data.parsed.info.state !== 'initialized'
  )
    throw new PaymentError('payer-account', 'The payer USDC account is not an initialized token account.');
  const destinationValue = z.object({ value: z.unknown().nullable() }).parse(destinationRaw).value;
  let recipientAccountExists = false;
  if (destinationValue !== null) {
    const account = tokenAccountSchema.parse(destinationValue);
    if (
      account.owner !== TOKEN_PROGRAM_ADDRESS ||
      account.data.parsed.info.mint !== mint ||
      account.data.parsed.info.owner !== recipient ||
      account.data.parsed.info.state !== 'initialized'
    )
      throw new PaymentError('recipient-account', 'The recipient USDC account is not usable.');
    recipientAccountExists = true;
  }
  const lamports = z.object({ value: z.number().int().safe().nonnegative() }).parse(balanceRaw).value;
  const latest = z
    .object({
      value: z.object({
        blockhash: z.string().min(32).max(44),
        lastValidBlockHeight: z.number().int().safe().nonnegative(),
      }),
    })
    .parse(blockhashRaw).value;
  return {
    source: String(source),
    destination: String(destination),
    recipientAccountExists,
    payerUsdc: BigInt(sourceAccount.data.parsed.info.tokenAmount.amount),
    payerLamports: BigInt(lamports),
    blockhash: latest.blockhash,
    lastValidBlockHeight: BigInt(latest.lastValidBlockHeight),
  };
}

export interface TransferPlan {
  paymentId: string;
  signer: KeyPairSigner;
  recipient: string;
  mint: string;
  amount: bigint;
  memo?: string;
  createRecipientAccount: boolean;
  blockhash: string;
  lastValidBlockHeight: bigint;
  priorityFeeMicroLamports: number;
}

export function directMemo(paymentId: string, memo?: string) {
  return memo ? `${DIRECT_MEMO_PREFIX}${paymentId}:${memo}` : `${DIRECT_MEMO_PREFIX}${paymentId}`;
}

/**
 * Compiles the exact transaction the payer will sign: compute budget, an
 * idempotent recipient account when needed, one TransferChecked of the approved
 * amount, and a memo naming the durable payment id. The unsigned wire form lets
 * the service simulate before any signature exists.
 */
export async function composeTransfer(plan: TransferPlan) {
  const mint = address(plan.mint);
  const recipient = address(plan.recipient);
  const [[source], [destination]] = await Promise.all([
    findAssociatedTokenPda({ owner: plan.signer.address, mint, tokenProgram: TOKEN_PROGRAM_ADDRESS }),
    findAssociatedTokenPda({ owner: recipient, mint, tokenProgram: TOKEN_PROGRAM_ADDRESS }),
  ]);
  const instructions: Instruction[] = [
    getSetComputeUnitLimitInstruction({
      units: plan.createRecipientAccount ? COMPUTE_UNITS_WITH_ACCOUNT : COMPUTE_UNITS_TRANSFER,
    }),
  ];
  if (plan.priorityFeeMicroLamports > 0)
    instructions.push(
      getSetComputeUnitPriceInstruction({ microLamports: plan.priorityFeeMicroLamports })
    );
  if (plan.createRecipientAccount)
    instructions.push(
      await getCreateAssociatedTokenIdempotentInstructionAsync({
        payer: plan.signer,
        owner: recipient,
        mint,
      })
    );
  instructions.push(
    getTransferCheckedInstruction({
      source,
      mint,
      destination,
      authority: plan.signer,
      amount: plan.amount,
      decimals: 6,
    }),
    {
      programAddress: address(MEMO_PROGRAM),
      accounts: [],
      data: getUtf8Encoder().encode(directMemo(plan.paymentId, plan.memo)),
    }
  );
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(plan.signer, m),
    (m) =>
      setTransactionMessageLifetimeUsingBlockhash(
        { blockhash: blockhash(plan.blockhash), lastValidBlockHeight: plan.lastValidBlockHeight },
        m
      ),
    (m) => appendTransactionMessageInstructions(instructions, m)
  );
  const compiled = compileTransaction(message);
  return {
    message,
    source: String(source),
    destination: String(destination),
    messageHash: sha256(Uint8Array.from(compiled.messageBytes)),
    messageBase64: getBase64Decoder().decode(compiled.messageBytes),
    unsignedWire: getBase64EncodedWireTransaction(compiled),
  };
}

/** Signs the compiled message. Called only after the ledger has durably claimed signing. */
export async function signTransfer(message: Awaited<ReturnType<typeof composeTransfer>>['message']) {
  const signed = await signTransactionMessageWithSigners(message);
  return {
    wire: getBase64EncodedWireTransaction(signed),
    signature: String(getSignatureFromTransaction(signed)),
    messageHash: sha256(Uint8Array.from(signed.messageBytes)),
  };
}

export interface DirectSettlementEvidence {
  signature: string;
  chainVerified: true;
  slot: number;
  feeLamports: string;
  proofObservedAt: string;
  createdRecipientAccount: boolean;
}
export type LandedTransaction =
  | { outcome: 'settled'; evidence: DirectSettlementEvidence }
  | { outcome: 'failed'; slot: number; error: string }
  | { outcome: 'mismatch'; detail: string };

const balanceSchema = z.object({
  accountIndex: z.number().int(),
  mint: z.string(),
  owner: z.string().optional(),
  uiTokenAmount: z.object({ amount: z.string().regex(/^\d+$/), decimals: z.number().int() }),
});
const landedSchema = z.object({
  slot: z.number().int().safe().nonnegative(),
  transaction: z.tuple([z.string(), z.literal('base64')]),
  meta: z.object({
    err: z.unknown().nullable(),
    fee: z.number().int().safe().nonnegative(),
    preTokenBalances: z.array(balanceSchema),
    postTokenBalances: z.array(balanceSchema),
  }),
});

/**
 * Reads a landed transaction back from a trusted RPC and proves it is the one
 * that was signed: same message bytes, same first signature, the payer's account
 * down by exactly the amount and the recipient's up by exactly the amount.
 */
export function inspectLandedTransaction(
  raw: unknown,
  expected: {
    signature: string;
    messageHash: string;
    source: string;
    destination: string;
    payer: string;
    recipient: string;
    mint: string;
    amount: bigint;
    createdRecipientAccount: boolean;
    maxFeeLamports: number;
    now?: number;
  }
): LandedTransaction | null {
  if (raw === null) return null;
  const tx = landedSchema.parse(raw);
  const bytes = Buffer.from(tx.transaction[0], 'base64');
  const landed = getTransactionDecoder().decode(bytes);
  const signatures = Object.values(landed.signatures);
  const first = signatures[0] ? getBase58Decoder().decode(signatures[0]) : '';
  if (sha256(Uint8Array.from(landed.messageBytes)) !== expected.messageHash || first !== expected.signature)
    return { outcome: 'mismatch', detail: 'Landed transaction does not match the signed message.' };
  if (tx.meta.err !== null)
    return { outcome: 'failed', slot: tx.slot, error: JSON.stringify(tx.meta.err).slice(0, 300) };
  const keys = getCompiledTransactionMessageDecoder()
    .decode(landed.messageBytes)
    .staticAccounts.map(String);
  const delta = (account: string, owner: string, allowMissingBefore: boolean) => {
    const index = keys.indexOf(account);
    const matches = (list: typeof tx.meta.preTokenBalances) =>
      list.filter(
        (b) =>
          b.accountIndex === index &&
          b.mint === expected.mint &&
          b.owner === owner &&
          b.uiTokenAmount.decimals === 6
      );
    const before = matches(tx.meta.preTokenBalances);
    const after = matches(tx.meta.postTokenBalances);
    if (after.length !== 1) return null;
    if (before.length === 0 && allowMissingBefore) return BigInt(after[0].uiTokenAmount.amount);
    if (before.length !== 1) return null;
    return BigInt(after[0].uiTokenAmount.amount) - BigInt(before[0].uiTokenAmount.amount);
  };
  if (
    tx.meta.fee > expected.maxFeeLamports ||
    delta(expected.source, expected.payer, false) !== -expected.amount ||
    delta(expected.destination, expected.recipient, expected.createdRecipientAccount) !==
      expected.amount
  )
    return { outcome: 'mismatch', detail: 'Landed token movement differs from the approved amount.' };
  return {
    outcome: 'settled',
    evidence: {
      signature: expected.signature,
      chainVerified: true,
      slot: tx.slot,
      feeLamports: String(tx.meta.fee),
      proofObservedAt: new Date(expected.now ?? Date.now()).toISOString(),
      createdRecipientAccount: expected.createdRecipientAccount,
    },
  };
}

const statusSchema = z.object({
  value: z.array(
    z
      .object({
        slot: z.number().int().safe().nonnegative(),
        confirmationStatus: z.enum(['processed', 'confirmed', 'finalized']).nullable().optional(),
        err: z.unknown().nullable(),
      })
      .nullable()
  ),
});

/** One signature status read; `confirmed` is the bar for settlement, `processed` is not. */
export async function signatureStatus(rpc: DirectRpc, signature: string, history = false) {
  const parsed = statusSchema.parse(
    await rpc.call('getSignatureStatuses', [[signature], { searchTransactionHistory: history }])
  );
  const status = parsed.value[0];
  if (!status) return { state: 'unknown' as const };
  if (status.err !== null) return { state: 'failed' as const, slot: status.slot };
  if (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized')
    return { state: 'confirmed' as const, slot: status.slot };
  return { state: 'processed' as const, slot: status.slot };
}

export async function blockHeight(rpc: DirectRpc): Promise<bigint> {
  return BigInt(
    z.number().int().safe().nonnegative().parse(await rpc.call('getBlockHeight', [{ commitment: 'confirmed' }]))
  );
}

export async function fetchLanded(rpc: DirectRpc, signature: string): Promise<unknown> {
  return rpc.call('getTransaction', [
    signature,
    { encoding: 'base64', commitment: 'confirmed', maxSupportedTransactionVersion: 0 },
  ]);
}
