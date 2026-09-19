import { z } from 'zod';
// Network and mint are captured in each immutable policy; never reinterpret existing receipts.
export const PAYMENT_CHAINS = {
  mainnet: {
    network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
    mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    genesisHash: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
    rpcUrl: 'https://api.mainnet-beta.solana.com',
  },
  devnet: {
    network: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
    mint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
    genesisHash: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
    rpcUrl: 'https://api.devnet.solana.com',
  },
} as const;
export type PaymentNetwork = keyof typeof PAYMENT_CHAINS;
export type PaymentChainId = (typeof PAYMENT_CHAINS)[PaymentNetwork]['network'];
export type UsdcMint = (typeof PAYMENT_CHAINS)[PaymentNetwork]['mint'];
export function paymentNetworkName(network: string): PaymentNetwork {
  if (network === PAYMENT_CHAINS.mainnet.network) return 'mainnet';
  if (network === PAYMENT_CHAINS.devnet.network) return 'devnet';
  throw new Error('Unsupported payment network.');
}
// Legacy exports retain their original meaning for saved devnet fixtures and integrations.
export const PAYMENT_NETWORK = PAYMENT_CHAINS.devnet.network;
export const USDC_MINT = PAYMENT_CHAINS.devnet.mint;
export const TOOL_NAMES = ['wallet_snapshot', 'transaction_explain'] as const;
export type ToolName = (typeof TOOL_NAMES)[number];
export type DataNetwork = 'devnet' | 'mainnet';
export const CATALOG = [
  {
    name: 'wallet_snapshot' as const,
    title: 'Wallet snapshot',
    price: '10000',
    path: '/merchant/wallet-snapshot',
    description: 'SOL balance and up to 8 recent signatures from Solana RPC.',
  },
  {
    name: 'transaction_explain' as const,
    title: 'Transaction explanation',
    price: '20000',
    path: '/merchant/transaction-explain',
    description: 'Grounded facts about one transaction, with explicit decoding limits.',
  },
];
export const DEFAULT_TASK =
  "Explain this Solana wallet's recent activity. Summarize the wallet, explain its latest transaction, and inspect another transaction if the budget permits.";
const MAX_UNITS = 1_000_000_000_000;
export function parseMoney(input: string): number {
  if (!/^(0|[1-9]\d{0,6})(\.\d{1,6})?$/.test(input))
    throw new Error('Use a positive decimal with at most six decimal places.');
  const [whole, fraction = ''] = input.split('.');
  const units = Number(whole) * 1_000_000 + Number(fraction.padEnd(6, '0'));
  if (!Number.isSafeInteger(units) || units > MAX_UNITS)
    throw new Error('Amount exceeds the supported limit.');
  return units;
}
export function units(input: string | number): number {
  if (typeof input === 'string' && !/^(0|[1-9]\d*)$/.test(input))
    throw new Error('Invalid integer amount.');
  const amount = Number(input);
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > MAX_UNITS)
    throw new Error('Invalid integer amount.');
  return amount;
}
export function formatMoney(input: string | number): string {
  const value = units(input);
  return `${Math.floor(value / 1_000_000)}.${String(value % 1_000_000).padStart(6, '0')}`;
}
export function isBase58Bytes(value: string, byteLength: number): boolean {
  if (!/^[1-9A-HJ-NP-Za-km-z]+$/.test(value) || value.length > 90) return false;
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let n = 0n;
  for (const c of value) n = n * 58n + BigInt(alphabet.indexOf(c));
  let bytes = 0;
  while (n > 0n) {
    bytes++;
    n >>= 8n;
  }
  for (const c of value) {
    if (c !== '1') break;
    bytes++;
  }
  return bytes === byteLength;
}
export const addressSchema = z
  .string()
  .max(44)
  .refine((v) => isBase58Bytes(v, 32), 'Enter a valid Solana address.');
export const signatureSchema = z
  .string()
  .max(88)
  .refine((v) => isBase58Bytes(v, 64), 'Enter a valid Solana transaction signature.');
export const toolArgs = {
  wallet_snapshot: z.object({ address: addressSchema }).strict(),
  transaction_explain: z.object({ signature: signatureSchema }).strict(),
};
export const createRunSchema = z
  .object({
    wallet: addressSchema,
    task: z.string().trim().min(10).max(1500),
    allowance: z.string().refine((v) => {
      try {
        return parseMoney(v) > 0;
      } catch {
        return false;
      }
    }, 'Invalid allowance.'),
    perRequestCap: z.string().refine((v) => {
      try {
        return parseMoney(v) > 0;
      } catch {
        return false;
      }
    }, 'Invalid per-request cap.'),
    expiresInMinutes: z.number().int().min(1).max(30),
    allowedTools: z
      .array(z.enum(TOOL_NAMES))
      .min(1)
      .max(2)
      .refine((v) => new Set(v).size === v.length),
  })
  .strict();
export type CreateRunInput = z.infer<typeof createRunSchema>;
export interface Policy {
  version: 1;
  allowance: string;
  perRequestCap: string;
  dailyCeiling: string;
  allowedTools: ToolName[];
  origin: string;
  recipient: string;
  network: PaymentChainId;
  mint: UsdcMint;
  expiresAt: string;
  runtimeExpiresAt?: string;
  callLimit: number;
}
export type PaymentStatus =
  | 'proposed'
  | 'denied'
  | 'reserved'
  | 'submitted'
  | 'settlement-unknown'
  | 'settled'
  | 'delivered'
  | 'settled-but-result-unavailable'
  | 'released';
export interface PurchaseDTO {
  id: string;
  tool: ToolName;
  amount: string;
  status: PaymentStatus;
  createdAt: string;
  reason?: string;
  signature?: string;
  chainVerified: boolean;
  result?: unknown;
  payer?: string;
  recipient?: string;
  feeSponsor?: string;
  feeLamports?: string;
  originalBlockhash?: string;
  originatingLastValidBlockHeight?: string;
  proofObservedAt?: string;
  deliveryState?: 'pending' | 'delivered' | 'unavailable';
  resultHash?: string;
  serviceOutcome: 'pending' | 'delivered' | 'unavailable';
  source: 'agent' | 'policy-probe';
}
export interface EventDTO {
  id: number;
  at: string;
  kind: string;
  title: string;
  detail: string;
  source: 'agent' | 'policy' | 'policy-probe' | 'system';
}
export interface RunDTO {
  id: string;
  wallet: string;
  task: string;
  status: 'queued' | 'running' | 'completed' | 'stopped' | 'expired' | 'failed' | 'interrupted';
  mode: 'live' | 'rehearsal';
  executionMode?: 'builtin' | 'external';
  paymentNetwork: PaymentNetwork;
  dataNetwork: DataNetwork;
  createdAt: string;
  policy: Policy;
  authorized: string;
  settled: string;
  held: string;
  remaining: string;
  purchases: PurchaseDTO[];
  events: EventDTO[];
  report: string | null;
  error: string | null;
  llm: {
    provider: 'OpenAI';
    model: string | null;
    calls: number;
    inputTokens: number;
    outputTokens: number;
    maxCalls: number;
    maxOutputTokens: number;
    note: string;
  };
}
export interface ReadinessItem {
  name: string;
  ready: boolean;
  detail: string;
}
export interface AppConfigDTO {
  tools: typeof CATALOG;
  paymentNetwork: PaymentNetwork;
  dataNetwork: DataNetwork;
  ready: boolean;
  externalReady: boolean;
  mcpEnabled: boolean;
  readiness: ReadinessItem[];
  payer: string | null;
  recipient: string | null;
  balance: { usdc: string | null; sol: string | null };
  dailyCeiling: string;
  dailyRemaining: string;
  defaultWallet: string;
  defaultTask: string;
  llm: { model: string | null; maxCalls: number; maxOutputTokens: number; note: string };
}
