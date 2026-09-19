import { isLosslessNumber, parse } from 'lossless-json';
import { z } from 'zod';

export const DEVNET_RPC = 'https://api.devnet.solana.com';
export const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
export const DEVNET_USDC = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const SYSTEM_PROGRAM = '11111111111111111111111111111111';
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const U64_MAX = 18_446_744_073_709_551_615n;
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export const HISTORY_LIMIT = 8;
const RESPONSE_LIMIT = 512 * 1024;

function base58HasBytes(value: string, length: number): boolean {
  if (value.length > 90 || !/^[1-9A-HJ-NP-Za-km-z]+$/.test(value)) return false;
  let decoded = 0n;
  for (const digit of value) decoded = decoded * 58n + BigInt(BASE58.indexOf(digit));
  const significantBytes = decoded === 0n ? 0 : Math.ceil(decoded.toString(16).length / 2);
  return (value.match(/^1*/)?.[0].length ?? 0) + significantBytes === length;
}

export const addressSchema = z
  .string()
  .min(32)
  .max(44)
  .refine((value) => base58HasBytes(value, 32), 'Expected a base58 Solana address (32 bytes)');
export const signatureSchema = z
  .string()
  .min(64)
  .max(88)
  .refine((value) => base58HasBytes(value, 64), 'Expected a base58 Solana signature (64 bytes)');
export const walletSnapshotArgsSchema = z.object({ address: addressSchema }).strict();
export const transactionExplainArgsSchema = z.object({ signature: signatureSchema }).strict();

function numericSource(value: unknown): unknown {
  if (isLosslessNumber(value)) return value.toString();
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value.toString();
  return value;
}
const unsignedString = z.preprocess(
  numericSource,
  z
    .string()
    .regex(/^(0|[1-9]\d*)$/)
    .max(20)
    .refine((value) => BigInt(value) <= U64_MAX)
);
const integer = z.preprocess((value) => {
  const raw = numericSource(value);
  return typeof raw === 'string' && /^-?(0|[1-9]\d*)$/.test(raw) ? Number(raw) : value;
}, z.number().int().safe());
const nonnegativeInteger = integer.refine((value) => value >= 0);
const time = nonnegativeInteger.nullable();
const transactionError = z.union([
  z.null(),
  z.string().max(512),
  z.record(z.string(), z.unknown()),
]);
const context = z.object({ slot: unsignedString });
const balanceResponse = z.object({ context, value: unsignedString });
const historyResponse = z
  .array(
    z.object({
      signature: signatureSchema,
      slot: unsignedString,
      blockTime: time,
      err: transactionError,
      confirmationStatus: z.enum(['processed', 'confirmed', 'finalized']).nullable().optional(),
    })
  )
  .max(HISTORY_LIMIT);
const parsedInstruction = z.object({
  programId: addressSchema,
  program: z.string().max(80).optional(),
  parsed: z
    .union([
      z.object({ type: z.string().max(100), info: z.record(z.string(), z.unknown()) }),
      z.string().max(4096),
    ])
    .optional(),
  accounts: z.array(addressSchema).max(256).optional(),
  data: z.string().max(16_384).optional(),
});
const tokenAmount = z.object({
  amount: unsignedString,
  decimals: nonnegativeInteger.refine((value) => value <= 255),
});
const tokenBalance = z.object({
  accountIndex: nonnegativeInteger.refine((value) => value < 256),
  mint: addressSchema,
  owner: addressSchema.optional(),
  programId: addressSchema.optional(),
  uiTokenAmount: tokenAmount,
});
const transactionResponse = z
  .object({
    slot: unsignedString,
    blockTime: time,
    version: z.union([z.literal('legacy'), integer.refine((value) => value === 0)]).optional(),
    transaction: z.object({
      signatures: z.array(signatureSchema).min(1).max(64),
      message: z.object({
        accountKeys: z
          .array(z.object({ pubkey: addressSchema, signer: z.boolean(), writable: z.boolean() }))
          .min(1)
          .max(256),
        instructions: z.array(parsedInstruction).max(128),
      }),
    }),
    meta: z
      .object({
        err: transactionError,
        fee: unsignedString,
        preBalances: z.array(unsignedString).max(256),
        postBalances: z.array(unsignedString).max(256),
        preTokenBalances: z.array(tokenBalance).max(256).nullable().optional(),
        postTokenBalances: z.array(tokenBalance).max(256).nullable().optional(),
        innerInstructions: z
          .array(
            z.object({
              index: nonnegativeInteger,
              instructions: z.array(parsedInstruction).max(128),
            })
          )
          .max(128)
          .nullable()
          .optional(),
      })
      .nullable(),
  })
  .nullable();

export type DataCluster = 'devnet' | 'mainnet-beta';
export type DataErrorCode =
  | 'INVALID_ARGUMENT'
  | 'RPC_UNAVAILABLE'
  | 'RPC_ERROR'
  | 'INVALID_RPC_RESPONSE'
  | 'RPC_RESPONSE_TOO_LARGE'
  | 'NETWORK_MISMATCH'
  | 'NETWORK_NOT_ENABLED'
  | 'TRANSACTION_NOT_FOUND'
  | 'TRANSACTION_METADATA_UNAVAILABLE';
export class SolanaDataError extends Error {
  constructor(
    readonly code: DataErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'SolanaDataError';
  }
}

/** Exact fixed-point rendering: no lamports or token amount passes through floating point. */
export function formatBaseUnits(amount: string, decimals: number): string {
  if (
    !/^-?(0|[1-9]\d*)$/.test(amount) ||
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > 255
  )
    throw new Error('Invalid base-unit amount');
  const negative = amount.startsWith('-');
  const unsigned = negative ? amount.slice(1) : amount;
  if (decimals === 0) return amount;
  const padded = unsigned.padStart(decimals + 1, '0');
  return `${negative ? '-' : ''}${padded.slice(0, -decimals)}.${padded.slice(-decimals)}`;
}

export interface SolanaDataOptions {
  rpcUrl?: string;
  cluster?: DataCluster;
  allowMainnetReadOnly?: boolean;
  fetch?: typeof fetch;
  timeoutMs?: number;
}
export interface InstructionFact {
  index: string;
  programId: string;
  type: 'sol-transfer' | 'token-transfer' | 'unsupported';
  source?: string;
  destination?: string;
  amountBaseUnits?: string;
  amount?: string;
  decimals?: number;
  mint?: string;
  description: string;
}

function decodeInstruction(
  instruction: z.infer<typeof parsedInstruction>,
  index: string
): InstructionFact {
  const unsupported = (description: string): InstructionFact => ({
    index,
    programId: instruction.programId,
    type: 'unsupported',
    description,
  });
  if (!instruction.parsed || typeof instruction.parsed === 'string')
    return unsupported('Instruction has no supported structured parser; decoding is unsupported.');
  const { type, info } = instruction.parsed;
  if (instruction.programId === SYSTEM_PROGRAM && type === 'transfer') {
    const facts = z
      .object({ source: addressSchema, destination: addressSchema, lamports: unsignedString })
      .safeParse(info);
    if (!facts.success)
      return unsupported('System transfer fields are invalid; no amount is inferred.');
    return {
      index,
      programId: instruction.programId,
      type: 'sol-transfer',
      source: facts.data.source,
      destination: facts.data.destination,
      amountBaseUnits: facts.data.lamports,
      amount: formatBaseUnits(facts.data.lamports, 9),
      decimals: 9,
      description: 'System Program SOL transfer instruction.',
    };
  }
  if (
    [TOKEN_PROGRAM, TOKEN_2022_PROGRAM].includes(instruction.programId) &&
    (type === 'transfer' || type === 'transferChecked')
  ) {
    const checked = z
      .object({
        source: addressSchema,
        destination: addressSchema,
        mint: addressSchema,
        tokenAmount,
      })
      .safeParse(info);
    if (type === 'transferChecked' && checked.success) {
      const facts = checked.data;
      return {
        index,
        programId: instruction.programId,
        type: 'token-transfer',
        source: facts.source,
        destination: facts.destination,
        amountBaseUnits: facts.tokenAmount.amount,
        amount: formatBaseUnits(facts.tokenAmount.amount, facts.tokenAmount.decimals),
        decimals: facts.tokenAmount.decimals,
        mint: facts.mint,
        description:
          'SPL token transferChecked instruction; account addresses are token accounts. Token-2022 extensions may affect received amounts; use balance changes for actual net effects.',
      };
    }
    const plain = z
      .object({ source: addressSchema, destination: addressSchema, amount: unsignedString })
      .safeParse(info);
    if (type === 'transfer' && plain.success)
      return {
        index,
        programId: instruction.programId,
        type: 'token-transfer',
        source: plain.data.source,
        destination: plain.data.destination,
        amountBaseUnits: plain.data.amount,
        description:
          'SPL token transfer instruction, in raw token units. This instruction does not contain mint or decimals; no token symbol or UI amount is inferred.',
      };
    return unsupported('Token transfer fields are invalid; no amount is inferred.');
  }
  return unsupported(`Unsupported instruction type: ${type}. No intent or value is inferred.`);
}

async function limitedBody(response: Response): Promise<string> {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > RESPONSE_LIMIT)
    throw new SolanaDataError('RPC_RESPONSE_TOO_LARGE', 'RPC response exceeds the data limit.');
  if (!response.body)
    throw new SolanaDataError('INVALID_RPC_RESPONSE', 'RPC returned an empty response body.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > RESPONSE_LIMIT)
        throw new SolanaDataError('RPC_RESPONSE_TOO_LARGE', 'RPC response exceeds the data limit.');
      text += decoder.decode(part.value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

export class SolanaDataClient {
  readonly cluster: DataCluster;
  private readonly endpoint: string;
  private readonly fetcher: typeof fetch;
  private readonly timeout: number;
  private readonly mainnetReadEnabled: boolean;
  private sequence = 0;
  private networkVerifiedAt = 0;

  constructor(options: SolanaDataOptions = {}) {
    this.cluster = options.cluster ?? 'devnet';
    if (this.cluster !== 'devnet' && this.cluster !== 'mainnet-beta')
      throw new Error('Unsupported Solana data network.');
    this.mainnetReadEnabled = options.allowMainnetReadOnly === true;
    const url = new URL(
      options.rpcUrl ??
        (this.cluster === 'devnet' ? DEVNET_RPC : 'https://api.mainnet-beta.solana.com')
    );
    if (url.protocol !== 'https:' || url.username || url.password || url.hash)
      throw new Error(
        'Data RPC must be a configured HTTPS URL without user credentials or fragment.'
      );
    this.endpoint = url.toString();
    this.fetcher = options.fetch ?? fetch;
    this.timeout = options.timeoutMs ?? 10_000;
    if (!Number.isSafeInteger(this.timeout) || this.timeout < 1 || this.timeout > 15_000)
      throw new Error('RPC timeout must be between 1 and 15000 ms.');
  }

  private async rpc<T>(method: string, params: unknown[], schema: z.ZodType<T>): Promise<T> {
    if (this.cluster === 'mainnet-beta' && !this.mainnetReadEnabled)
      throw new SolanaDataError(
        'NETWORK_NOT_ENABLED',
        'Mainnet data reads require ALLOW_MAINNET_READ_ONLY=true.'
      );
    const id = ++this.sequence;
    try {
      const response = await this.fetcher(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
        redirect: 'error',
        signal: AbortSignal.timeout(this.timeout),
      });
      if (!response.ok)
        throw new SolanaDataError(
          'RPC_UNAVAILABLE',
          `Solana RPC returned HTTP ${response.status}.`
        );
      const raw: unknown = parse(await limitedBody(response));
      const envelope = z
        .object({
          jsonrpc: z.literal('2.0'),
          id: integer,
          result: z.unknown().optional(),
          error: z.object({ code: integer, message: z.string().max(2048) }).optional(),
        })
        .parse(raw);
      if (envelope.id !== id || (envelope.error !== undefined && envelope.result !== undefined))
        throw new SolanaDataError('INVALID_RPC_RESPONSE', 'RPC response identity is invalid.');
      if (envelope.error)
        throw new SolanaDataError(
          'RPC_ERROR',
          `Solana RPC rejected ${method} (code ${envelope.error.code}).`
        );
      return schema.parse(envelope.result);
    } catch (error) {
      if (error instanceof SolanaDataError) throw error;
      if (error instanceof z.ZodError || error instanceof SyntaxError)
        throw new SolanaDataError(
          'INVALID_RPC_RESPONSE',
          'Solana RPC returned data that failed validation.'
        );
      throw new SolanaDataError('RPC_UNAVAILABLE', 'Solana RPC request failed or timed out.');
    }
  }

  private async verifyNetwork(): Promise<string> {
    const genesis = await this.rpc('getGenesisHash', [], addressSchema);
    const expected = this.cluster === 'devnet' ? DEVNET_GENESIS : MAINNET_GENESIS;
    if (genesis !== expected)
      throw new SolanaDataError(
        'NETWORK_MISMATCH',
        'Configured data RPC returned the wrong network genesis.'
      );
    this.networkVerifiedAt = Date.now();
    return genesis;
  }

  private async ensureNetwork(): Promise<void> {
    if (Date.now() - this.networkVerifiedAt > 60_000) await this.verifyNetwork();
  }

  async probe() {
    const genesis = await this.verifyNetwork();
    return {
      ready: true as const,
      dataCluster: this.cluster,
      genesis,
      observedAt: new Date().toISOString(),
      readOnly: true as const,
    };
  }

  async verifyDevnetUsdc() {
    if (this.cluster !== 'devnet')
      throw new SolanaDataError(
        'NETWORK_MISMATCH',
        'Mint preflight must use a dedicated devnet RPC client.'
      );
    await this.ensureNetwork();
    const mint = await this.rpc(
      'getAccountInfo',
      [DEVNET_USDC, { encoding: 'jsonParsed', commitment: 'confirmed' }],
      z.object({
        context,
        value: z.object({
          owner: z.literal(TOKEN_PROGRAM),
          executable: z.literal(false),
          data: z.object({
            parsed: z.object({
              type: z.literal('mint'),
              info: z.object({
                decimals: integer.refine((value) => value === 6),
                isInitialized: z.literal(true),
              }),
            }),
          }),
        }),
      })
    );
    return {
      mint: DEVNET_USDC,
      owner: mint.value.owner,
      decimals: mint.value.data.parsed.info.decimals,
      slot: mint.context.slot,
      observedAt: new Date().toISOString(),
    };
  }

  async walletSnapshot(address: string) {
    if (!addressSchema.safeParse(address).success)
      throw new SolanaDataError('INVALID_ARGUMENT', 'Provide a valid Solana wallet address.');
    await this.ensureNetwork();
    const balance = await this.rpc(
      'getBalance',
      [address, { commitment: 'confirmed' }],
      balanceResponse
    );
    const balanceSlot = Number(balance.context.slot);
    if (!Number.isSafeInteger(balanceSlot))
      throw new SolanaDataError(
        'INVALID_RPC_RESPONSE',
        'Balance slot exceeds the safely supported request range.'
      );
    const recent = await this.rpc(
      'getSignaturesForAddress',
      [address, { limit: HISTORY_LIMIT, commitment: 'confirmed', minContextSlot: balanceSlot }],
      historyResponse
    );
    return {
      address,
      dataCluster: this.cluster,
      balanceLamports: balance.value,
      balanceSol: formatBaseUnits(balance.value, 9),
      recentSignatures: recent.map((item) => ({
        signature: item.signature,
        slot: item.slot,
        blockTime: item.blockTime,
        status: item.err === null ? 'success' : 'failed',
        confirmationStatus: item.confirmationStatus ?? null,
      })),
      historyState: recent.length === 0 ? 'empty' : 'available',
      provenance: {
        source: 'Solana JSON-RPC',
        commitment: 'confirmed',
        balanceSlot: balance.context.slot,
        observedAt: new Date().toISOString(),
        historyLimit: HISTORY_LIMIT,
      },
      limitations: [
        'History is limited to the eight most recent signatures retained by this RPC.',
        'A zero balance or empty history is valid; this does not establish an account owner or complete lifetime history.',
        'Balance and history are separate RPC reads, not an atomic snapshot.',
      ],
    };
  }

  async transactionExplain(signature: string) {
    if (!signatureSchema.safeParse(signature).success)
      throw new SolanaDataError(
        'INVALID_ARGUMENT',
        'Provide a valid Solana transaction signature.'
      );
    await this.ensureNetwork();
    const tx = await this.rpc(
      'getTransaction',
      [
        signature,
        { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 0 },
      ],
      transactionResponse
    );
    if (!tx)
      throw new SolanaDataError(
        'TRANSACTION_NOT_FOUND',
        'Transaction is not available at confirmed commitment on the configured data network. It may be unconfirmed or outside this RPC history.'
      );
    if (tx.transaction.signatures[0] !== signature)
      throw new SolanaDataError(
        'INVALID_RPC_RESPONSE',
        'RPC returned a different transaction signature.'
      );
    if (!tx.meta)
      throw new SolanaDataError(
        'TRANSACTION_METADATA_UNAVAILABLE',
        'Transaction metadata is unavailable; success and balance effects cannot be established.'
      );
    const meta = tx.meta;
    const accounts = tx.transaction.message.accountKeys;
    if (meta.preBalances.length !== accounts.length || meta.postBalances.length !== accounts.length)
      throw new SolanaDataError(
        'INVALID_RPC_RESPONSE',
        'Transaction balance vector length does not match accounts.'
      );
    const nativeBalanceChanges = accounts.flatMap((account, index) => {
      const before = meta.preBalances[index]!;
      const after = meta.postBalances[index]!;
      const delta = (BigInt(after) - BigInt(before)).toString();
      return delta === '0'
        ? []
        : [
            {
              address: account.pubkey,
              beforeLamports: before,
              afterLamports: after,
              deltaLamports: delta,
              deltaSol: formatBaseUnits(delta, 9),
            },
          ];
    });
    const tokens = new Map<
      string,
      { before?: z.infer<typeof tokenBalance>; after?: z.infer<typeof tokenBalance> }
    >();
    for (const [side, balances] of [
      ['before', meta.preTokenBalances ?? []],
      ['after', meta.postTokenBalances ?? []],
    ] as const) {
      for (const balance of balances) {
        if (!accounts[balance.accountIndex])
          throw new SolanaDataError(
            'INVALID_RPC_RESPONSE',
            'Token balance references an unknown account.'
          );
        const key = `${balance.accountIndex}:${balance.mint}`;
        const existing = tokens.get(key) ?? {};
        if (existing[side])
          throw new SolanaDataError('INVALID_RPC_RESPONSE', 'Duplicate token balance entry.');
        existing[side] = balance;
        tokens.set(key, existing);
      }
    }
    const tokenBalanceChanges = [...tokens.values()].flatMap(({ before, after }) => {
      const known = after ?? before!;
      if (before && after && before.uiTokenAmount.decimals !== after.uiTokenAmount.decimals)
        throw new SolanaDataError(
          'INVALID_RPC_RESPONSE',
          'Token decimals changed within a transaction.'
        );
      const pre = before?.uiTokenAmount.amount ?? '0';
      const post = after?.uiTokenAmount.amount ?? '0';
      const delta = (BigInt(post) - BigInt(pre)).toString();
      return delta === '0'
        ? []
        : [
            {
              account: accounts[known.accountIndex]!.pubkey,
              owner: known.owner ?? null,
              mint: known.mint,
              decimals: known.uiTokenAmount.decimals,
              beforeBaseUnits: pre,
              afterBaseUnits: post,
              deltaBaseUnits: delta,
              delta: formatBaseUnits(delta, known.uiTokenAmount.decimals),
              coverage: !before ? 'post-only' : !after ? 'pre-only' : 'both',
            },
          ];
    });
    const instructions = tx.transaction.message.instructions.map((item, index) =>
      decodeInstruction(item, `${index}`)
    );
    for (const group of meta.innerInstructions ?? []) {
      if (group.index >= tx.transaction.message.instructions.length)
        throw new SolanaDataError(
          'INVALID_RPC_RESPONSE',
          'Inner instruction references an unknown parent.'
        );
      instructions.push(
        ...group.instructions.map((item, index) =>
          decodeInstruction(item, `${group.index}.${index}`)
        )
      );
    }
    if (instructions.length > 256)
      throw new SolanaDataError(
        'INVALID_RPC_RESPONSE',
        'Transaction exceeds the supported instruction count.'
      );
    return {
      signature,
      dataCluster: this.cluster,
      status: meta.err === null ? 'success' : 'failed',
      feeLamports: meta.fee,
      feeSol: formatBaseUnits(meta.fee, 9),
      feePayer: accounts[0]!.pubkey,
      instructions,
      nativeBalanceChanges,
      tokenBalanceChanges,
      provenance: {
        source: 'Solana JSON-RPC',
        commitment: 'confirmed',
        slot: tx.slot,
        blockTime: tx.blockTime,
        observedAt: new Date().toISOString(),
        maxSupportedTransactionVersion: 0,
      },
      limitations: [
        'Instructions describe attempted actions. Failed transactions do not apply those transfers, though fees can be charged.',
        'Only plain System Program and SPL token transfers are decoded; other instructions are explicitly unsupported.',
        'Balances report net account changes, which may include rent or fees; they do not establish identity, intent, or asset value.',
        'A pre-only or post-only token entry assumes zero on its absent side; missing entire token-balance metadata means token coverage is unavailable.',
      ],
      tokenBalanceCoverage:
        meta.preTokenBalances == null || meta.postTokenBalances == null
          ? 'unavailable-or-partial'
          : 'available',
    };
  }
}
