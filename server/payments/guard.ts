import { createHash, createPublicKey, verify } from 'node:crypto';
import { address, getBase58Decoder, getBase58Encoder } from '@solana/kit';
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import type { PaymentRequired, PaymentRequirements, PaymentPayload } from '@x402/core/types';
import { isPaymentIdentifierExtension } from '@x402/extensions/payment-identifier';
import {
  CATALOG,
  PAYMENT_CHAINS,
  paymentNetworkName,
  type PaymentChainId,
  type UsdcMint,
  toolArgs,
  type ToolName,
} from '../../shared/domain.js';

export const COMPUTE_PROGRAM = 'ComputeBudget111111111111111111111111111111';
export const MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
export class PaymentError extends Error {
  constructor(
    public code: string,
    message: string,
    public intentId?: string
  ) {
    super(message);
  }
}
export function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}
export function canonicalRequest(tool: ToolName, args: unknown, origin: string) {
  const catalog = CATALOG.find((item) => item.name === tool);
  if (!catalog) throw new PaymentError('invalid-tool', 'Tool is not permitted.');
  const parsed = toolArgs[tool].parse(args);
  const body = JSON.stringify(parsed);
  const url = new URL(catalog.path, origin).href;
  return { hash: sha256(`POST\n${url}\n${body}`), body, url, path: catalog.path };
}
export function paymentMemo(id: string, hash: string): string {
  return `allowance:${id}:${hash}`;
}
export function validateOrigin(origin: string, allowLocalHttp: boolean): string {
  const u = new URL(origin);
  if (u.username || u.password || u.search || u.hash || u.pathname !== '/')
    throw new PaymentError('origin', 'Merchant must be an exact origin.');
  if (
    u.protocol !== 'https:' &&
    !(
      allowLocalHttp &&
      u.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)
    )
  )
    throw new PaymentError(
      'origin',
      'Merchant requires HTTPS or the explicitly configured local development origin.'
    );
  return u.origin;
}
export function validateRequirements(
  required: PaymentRequired,
  expected: {
    url: string;
    amount: string;
    recipient: string;
    sponsor: string;
    memo: string;
    network: PaymentChainId;
    mint: UsdcMint;
  }
): PaymentRequirements {
  if (
    required.x402Version !== 2 ||
    required.resource?.url !== expected.url ||
    required.accepts?.length !== 1
  )
    throw new PaymentError(
      'invalid-challenge',
      'Unexpected payment version, resource, or payment options.'
    );
  const r = required.accepts[0];
  if (
    r.scheme !== 'exact' ||
    r.network !== expected.network ||
    expected.mint !== PAYMENT_CHAINS[paymentNetworkName(expected.network)].mint ||
    r.asset !== expected.mint ||
    r.payTo !== expected.recipient ||
    r.amount !== expected.amount
  )
    throw new PaymentError('policy-mismatch', 'Payment terms do not match the approved catalog.');
  // maxTimeoutSeconds is a duration. Local policy expiry and blockhash validity are checked separately.
  if (
    !Number.isInteger(r.maxTimeoutSeconds) ||
    r.maxTimeoutSeconds < 1 ||
    r.maxTimeoutSeconds > 120
  )
    throw new PaymentError('invalid-timeout', 'Unsupported protocol settlement timeout.');
  if (
    r.extra?.feePayer !== expected.sponsor ||
    r.extra?.memo !== expected.memo ||
    (r.extra?.paymentFlow !== undefined && r.extra.paymentFlow !== 'authorization')
  )
    throw new PaymentError(
      'sponsor-mismatch',
      'Untrusted sponsor, request binding, or payment flow.'
    );
  const keys = Object.keys(r.extra ?? {});
  if (keys.some((key) => !['feePayer', 'memo', 'paymentFlow'].includes(key)))
    throw new PaymentError('extra-requirements', 'Unexpected transaction requirements.');
  const identifier = required.extensions?.['payment-identifier'];
  if (
    !isPaymentIdentifierExtension(identifier) ||
    identifier.info.required !== true ||
    Object.keys(required.extensions ?? {}).some((key) => key !== 'payment-identifier')
  )
    throw new PaymentError(
      'idempotency-unavailable',
      'Merchant does not support durable payment identifiers.'
    );
  return r;
}
class Bytes {
  private offset = 0;
  constructor(private bytes: Uint8Array) {}
  read(n: number): Uint8Array {
    if (n < 0 || this.offset + n > this.bytes.length)
      throw new PaymentError('transaction', 'Truncated transaction.');
    const out = this.bytes.slice(this.offset, this.offset + n);
    this.offset += n;
    return out;
  }
  byte(): number {
    return this.read(1)[0];
  }
  compact(): number {
    let value = 0;
    for (let i = 0; i < 3; i++) {
      const b = this.byte();
      value |= (b & 127) << (i * 7);
      if (!(b & 128)) {
        if (i > 0 && b === 0)
          throw new PaymentError('transaction', 'Noncanonical transaction length.');
        return value;
      }
    }
    throw new PaymentError('transaction', 'Invalid transaction length.');
  }
  done(): boolean {
    return this.offset === this.bytes.length;
  }
  remainder(): Uint8Array {
    return this.read(this.bytes.length - this.offset);
  }
}
export function decodeMessage(bytes: Uint8Array) {
  if (bytes.length > 1100) throw new PaymentError('transaction', 'Transaction is too large.');
  const r = new Bytes(bytes);
  if (r.byte() !== 128)
    throw new PaymentError('transaction', 'Only static version 0 transactions are permitted.');
  const signed = r.byte(),
    readonlySigned = r.byte(),
    readonlyUnsigned = r.byte(),
    count = r.compact();
  if (count < 7 || count > 10 || signed !== 2 || readonlySigned !== 1)
    throw new PaymentError('transaction', 'Unexpected signer or account set.');
  const keys = Array.from({ length: count }, () => getBase58Decoder().decode(r.read(32)));
  if (new Set(keys).size !== keys.length || readonlyUnsigned > count - signed)
    throw new PaymentError('transaction', 'Invalid account layout.');
  const blockhash = getBase58Decoder().decode(r.read(32));
  const n = r.compact();
  if (n !== 4)
    throw new PaymentError('transaction', 'Exactly four approved instructions are required.');
  const instructions = Array.from({ length: n }, () => {
    const programIndex = r.byte();
    const accountCount = r.compact();
    if (accountCount > 4) throw new PaymentError('transaction', 'Unexpected instruction accounts.');
    const indexes = Array.from(r.read(accountCount));
    const size = r.compact();
    if (size > 300) throw new PaymentError('transaction', 'Instruction data exceeds the limit.');
    const data = r.read(size);
    if (programIndex >= count || indexes.some((i) => i >= count))
      throw new PaymentError('transaction', 'Invalid account index.');
    return { program: keys[programIndex], accounts: indexes.map((i) => keys[i]), indexes, data };
  });
  if (r.compact() !== 0 || !r.done())
    throw new PaymentError('transaction', 'Address lookup tables and trailing data are forbidden.');
  const writable = keys.filter((_, i) =>
    i < signed ? i < signed - readonlySigned : i < count - readonlyUnsigned
  );
  return { keys, blockhash, instructions, writable, signers: keys.slice(0, signed) };
}
export async function expectedAccounts(payer: string, recipient: string, mint: UsdcMint) {
  const [[source], [destination]] = await Promise.all([
    findAssociatedTokenPda({
      owner: address(payer),
      mint: address(mint),
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    }),
    findAssociatedTokenPda({
      owner: address(recipient),
      mint: address(mint),
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    }),
  ]);
  return { source: String(source), destination: String(destination) };
}
export async function validateTransaction(
  bytes: Uint8Array,
  expected: {
    payer: string;
    sponsor: string;
    recipient: string;
    amount: string;
    memo: string;
    mint: UsdcMint;
  }
) {
  const decoded = decodeMessage(bytes);
  const { source, destination } = await expectedAccounts(
    expected.payer,
    expected.recipient,
    expected.mint
  );
  const exactKeys = new Set([
    expected.sponsor,
    expected.payer,
    source,
    destination,
    expected.mint,
    String(TOKEN_PROGRAM_ADDRESS),
    COMPUTE_PROGRAM,
    MEMO_PROGRAM,
  ]);
  if (
    expected.payer === expected.sponsor ||
    expected.payer === expected.recipient ||
    decoded.keys.length !== exactKeys.size ||
    decoded.keys.some((key) => !exactKeys.has(key)) ||
    decoded.signers[0] !== expected.sponsor ||
    decoded.signers[1] !== expected.payer
  )
    throw new PaymentError('transaction', 'Unexpected token owner, sponsor or accounts.');
  if (
    decoded.writable.length !== 3 ||
    decoded.writable.some((key) => ![expected.sponsor, source, destination].includes(key))
  )
    throw new PaymentError('transaction', 'Unexpected writable accounts.');
  const [limit, price, transfer, memo] = decoded.instructions;
  if (
    limit.program !== COMPUTE_PROGRAM ||
    limit.accounts.length ||
    limit.data.length !== 5 ||
    limit.data[0] !== 2 ||
    Buffer.from(limit.data).readUInt32LE(1) !== 20_000
  )
    throw new PaymentError('transaction', 'Compute limit is not the approved SDK limit.');
  if (
    price.program !== COMPUTE_PROGRAM ||
    price.accounts.length ||
    price.data.length !== 9 ||
    price.data[0] !== 3 ||
    Buffer.from(price.data).readBigUInt64LE(1) !== 1n
  )
    throw new PaymentError('transaction', 'Priority fee is not the approved SDK price.');
  if (
    transfer.program !== TOKEN_PROGRAM_ADDRESS ||
    transfer.accounts.join(',') !==
      [source, expected.mint, destination, expected.payer].join(',') ||
    transfer.data.length !== 10 ||
    transfer.data[0] !== 12 ||
    transfer.data[9] !== 6 ||
    Buffer.from(transfer.data).readBigUInt64LE(1) !== BigInt(expected.amount)
  )
    throw new PaymentError('transaction', 'Transfer must be exactly the approved USDC amount.');
  if (
    memo.program !== MEMO_PROGRAM ||
    memo.accounts.length ||
    Buffer.from(memo.data).toString('utf8') !== expected.memo
  )
    throw new PaymentError(
      'transaction',
      'Transaction does not bind the original request and payment identifier.'
    );
  return { ...decoded, source, destination, messageHash: sha256(bytes) };
}
export function decodePaymentTransaction(payload: PaymentPayload) {
  const encoded = payload.payload?.transaction;
  if (typeof encoded !== 'string' || encoded.length > 1800 || !/^[A-Za-z0-9+/]+=*$/.test(encoded))
    throw new PaymentError('transaction', 'Invalid payment transaction.');
  const raw = Buffer.from(encoded, 'base64');
  const r = new Bytes(raw);
  const n = r.compact();
  if (n !== 2 || raw.length > 1232)
    throw new PaymentError('transaction', 'Unexpected signature count.');
  const signatures = Array.from({ length: n }, () => r.read(64));
  const message = r.remainder();
  return { signatures, message, decoded: decodeMessage(message) };
}
export function verifyPayerSignature(payload: PaymentPayload): string {
  const { signatures, message, decoded } = decodePaymentTransaction(payload);
  const payer = decoded.signers[1];
  const publicKey = createPublicKey({
    key: Buffer.concat([
      Buffer.from('302a300506032b6570032100', 'hex'),
      Buffer.from(getBase58Encoder().encode(payer)),
    ]),
    format: 'der',
    type: 'spki',
  });
  if (!verify(null, Buffer.from(message), publicKey, Buffer.from(signatures[1])))
    throw new PaymentError('signature', 'Token owner signature is invalid.');
  return payer;
}
