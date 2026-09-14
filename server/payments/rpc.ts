import { z } from 'zod';
import { USDC_MINT, isBase58Bytes } from '../../shared/domain.js';
import { TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import { decodePaymentTransaction, expectedAccounts, PaymentError, sha256 } from './guard.js';
import type { PaymentPayload } from '@x402/core/types';
import { DEVNET_GENESIS } from '../data/solana.js';
export async function boundedJson(response: Response, maxBytes = 1_000_000): Promise<unknown> {
  if (!response.body)
    throw new PaymentError('empty-response', 'Service returned an empty response.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes)
        throw new PaymentError('response-size', 'Service response exceeds its limit.');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}
const accountSchema = z.object({
  owner: z.string(),
  data: z.object({
    parsed: z.object({ type: z.string(), info: z.record(z.string(), z.unknown()) }),
  }),
});
export class PaymentRpc {
  constructor(
    readonly url: string,
    private fetcher: typeof fetch = fetch
  ) {}
  async call(method: string, params: unknown[]): Promise<unknown> {
    const response = await this.fetcher(this.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok)
      throw new PaymentError('rpc-unavailable', `Payment RPC returned HTTP ${response.status}.`);
    const body = z
      .object({ error: z.unknown().optional(), result: z.unknown().optional() })
      .parse(await boundedJson(response));
    if (body.error || body.result === undefined)
      throw new PaymentError('rpc-error', 'Payment RPC could not complete the bounded read.');
    return body.result;
  }
  async preflight(payer: string, recipient: string) {
    if ((await this.call('getGenesisHash', [])) !== DEVNET_GENESIS)
      throw new PaymentError('network', 'Payment RPC is not Solana devnet.');
    const { source, destination } = await expectedAccounts(payer, recipient);
    const [mint, sourceAccount, destinationAccount, balance] = await Promise.all([
      this.call('getAccountInfo', [USDC_MINT, { encoding: 'jsonParsed', commitment: 'confirmed' }]),
      this.call('getAccountInfo', [source, { encoding: 'jsonParsed', commitment: 'confirmed' }]),
      this.call('getAccountInfo', [
        destination,
        { encoding: 'jsonParsed', commitment: 'confirmed' },
      ]),
      this.call('getBalance', [payer, { commitment: 'confirmed' }]),
    ]);
    const mintAccount = accountSchema.parse(z.object({ value: z.unknown() }).parse(mint).value);
    if (
      mintAccount.owner !== TOKEN_PROGRAM_ADDRESS ||
      mintAccount.data.parsed.type !== 'mint' ||
      mintAccount.data.parsed.info.decimals !== 6 ||
      mintAccount.data.parsed.info.isInitialized !== true
    )
      throw new PaymentError(
        'mint',
        'Configured mint must be the initialized Circle devnet SPL USDC mint with six decimals.'
      );
    const src = accountSchema.parse(z.object({ value: z.unknown() }).parse(sourceAccount).value);
    const dst = accountSchema.parse(
      z.object({ value: z.unknown() }).parse(destinationAccount).value
    );
    for (const [a, owner] of [
      [src, payer],
      [dst, recipient],
    ] as const) {
      if (
        a.owner !== TOKEN_PROGRAM_ADDRESS ||
        a.data.parsed.type !== 'account' ||
        a.data.parsed.info.mint !== USDC_MINT ||
        a.data.parsed.info.owner !== owner ||
        a.data.parsed.info.state !== 'initialized'
      )
        throw new PaymentError(
          'ata',
          'Payer and merchant must already have initialized USDC associated token accounts.'
        );
    }
    const token = z
      .object({ amount: z.string().regex(/^\d+$/), decimals: z.literal(6) })
      .parse(src.data.parsed.info.tokenAmount);
    const sol = z.object({ value: z.number().int().safe().nonnegative() }).parse(balance).value;
    return { usdc: token.amount, sol: String(sol), source, destination };
  }
  async validateLifetimeAndFee(message: Uint8Array, blockhash: string, maxFeeLamports: number) {
    const [valid, fee] = await Promise.all([
      this.call('isBlockhashValid', [blockhash, { commitment: 'confirmed' }]),
      this.call('getFeeForMessage', [
        Buffer.from(message).toString('base64'),
        { commitment: 'confirmed' },
      ]),
    ]);
    if (z.object({ value: z.boolean() }).parse(valid).value !== true)
      throw new PaymentError('blockhash', 'Transaction blockhash has expired.');
    const charged = z.object({ value: z.number().int().nonnegative().nullable() }).parse(fee).value;
    if (charged === null || charged > maxFeeLamports)
      throw new PaymentError(
        'fee-limit',
        'Transaction SOL fee is unavailable or exceeds the approved bound.'
      );
  }
  async evidence(
    signature: string,
    payload: PaymentPayload,
    amount: string,
    recipient: string
  ): Promise<{
    signature: string;
    chainVerified: true;
    proofObservedAt?: string;
    originalBlockhash?: string;
    slot: number;
    feeLamports: string;
    feeSponsor: string;
  } | null> {
    if (!isBase58Bytes(signature, 64)) return null;
    const raw = await this.call('getTransaction', [
      signature,
      { encoding: 'base64', commitment: 'confirmed', maxSupportedTransactionVersion: 0 },
    ]);
    if (raw === null) return null;
    const balance = z.object({
      accountIndex: z.number().int(),
      mint: z.string(),
      owner: z.string().optional(),
      uiTokenAmount: z.object({ amount: z.string().regex(/^\d+$/), decimals: z.number().int() }),
    });
    const tx = z
      .object({
        slot: z.number().int(),
        transaction: z.tuple([z.string(), z.literal('base64')]),
        meta: z.object({
          err: z.unknown().nullable(),
          fee: z.number().int().safe(),
          preTokenBalances: z.array(balance),
          postTokenBalances: z.array(balance),
        }),
      })
      .parse(raw);
    if (tx.meta.err !== null) return null;
    const original = decodePaymentTransaction(payload);
    const landed = decodePaymentTransaction({
      ...payload,
      payload: { transaction: tx.transaction[0] },
    });
    if (sha256(original.message) !== sha256(landed.message)) return null;
    const payer = original.decoded.signers[1],
      sponsor = original.decoded.signers[0];
    const { source, destination } = await expectedAccounts(payer, recipient);
    const delta = (ata: string, owner: string) => {
      const index = landed.decoded.keys.indexOf(ata);
      const before = tx.meta.preTokenBalances.find(
        (b) =>
          b.accountIndex === index &&
          b.mint === USDC_MINT &&
          b.owner === owner &&
          b.uiTokenAmount.decimals === 6
      );
      const after = tx.meta.postTokenBalances.find(
        (b) =>
          b.accountIndex === index &&
          b.mint === USDC_MINT &&
          b.owner === owner &&
          b.uiTokenAmount.decimals === 6
      );
      return before && after
        ? BigInt(after.uiTokenAmount.amount) - BigInt(before.uiTokenAmount.amount)
        : null;
    };
    if (
      delta(source, payer) !== -BigInt(amount) ||
      delta(destination, recipient) !== BigInt(amount)
    )
      return null;
    return {
      signature,
      chainVerified: true,
      proofObservedAt: new Date().toISOString(),
      originalBlockhash: original.decoded.blockhash,
      slot: tx.slot,
      feeLamports: String(tx.meta.fee),
      feeSponsor: sponsor,
    };
  }
  async findSettlement(payload: PaymentPayload, amount: string, recipient: string) {
    const { decoded } = decodePaymentTransaction(payload);
    const { source } = await expectedAccounts(decoded.signers[1], recipient);
    const recent = z
      .array(z.object({ signature: z.string(), err: z.unknown().nullable() }))
      .max(12)
      .parse(
        await this.call('getSignaturesForAddress', [source, { limit: 12, commitment: 'confirmed' }])
      );
    for (const candidate of recent.filter((row) => row.err === null)) {
      const evidence = await this.evidence(candidate.signature, payload, amount, recipient);
      if (evidence) return evidence;
    }
    return null;
  }
}
