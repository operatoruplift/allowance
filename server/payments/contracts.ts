import type Database from 'better-sqlite3';
import type { PaymentPayload, PaymentRequirements } from '@x402/core/types';
import type { ToolName, PaymentNetwork } from '../../shared/domain.js';

export interface PurchaseProposal {
  runId: string;
  requestId: string;
  canonicalHash: string;
  tool: ToolName;
  amount: string;
  origin: string;
  path: string;
  method: 'POST';
  recipient: string;
  network: string;
  mint: string;
  source?: 'agent' | 'policy-probe';
}
export interface PaymentIntent {
  id: string;
  runId: string;
  requestId: string;
  canonicalHash: string;
  tool: ToolName;
  amount: string;
  status: string;
  result?: unknown;
  signature?: string;
}
export interface SigningEvidence {
  messageHash: string;
  blockhash: string;
  payer: string;
  feeSponsor: string;
}
export interface SignedEvidence extends SigningEvidence {
  payerSignature: string;
  payload: PaymentPayload;
}
export interface SettlementEvidence {
  signature: string;
  chainVerified: boolean;
  /** Time the settlement observation was recorded; it is not a claim that the chain verified it. */
  proofObservedAt?: string;
  /** The blockhash from the originally signed transaction, when persisted. */
  originalBlockhash?: string;
  /** Solana's originating validity bound when the payment provider exposes it. */
  originatingLastValidBlockHeight?: string;
  deliveryState?: 'pending' | 'delivered' | 'unavailable';
  resultHash?: string;
  feeSponsor?: string;
  slot?: number;
  feeLamports?: string;
  note?: string;
}
/** Synchronous SQLite mutations must throw on denial or database failure. */
export interface PaymentLedger {
  db: Database.Database;
  reserve(proposal: PurchaseProposal): { created: boolean; intent: PaymentIntent };
  checkBeforeSign(intentId: string): void;
  /** Atomically claims signing. A crash from this point must hold/freeze funds. */
  markSigning(intentId: string, evidence: SigningEvidence): void;
  markSigned(intentId: string, evidence: SignedEvidence): void;
  markSubmitted(intentId: string): void;
  markUnknown(intentId: string, reason: string): void;
  markSettled(intentId: string, evidence: SettlementEvidence): void;
  markDelivered(intentId: string, result: unknown): void;
  markResultUnavailable(intentId: string, reason: string): void;
  rejectUnsigned(intentId: string, reason: string): void;
  getIntent(intentId: string): PaymentIntent | undefined;
}
export interface DataTools {
  walletSnapshot(address: string): Promise<unknown>;
  transactionExplain(signature: string): Promise<unknown>;
}
export interface PaymentConfig {
  network: PaymentNetwork;
  enabled: boolean;
  merchantOrigin: string;
  recipient?: string;
  rpcUrl?: string;
  keyFile?: string;
  secretKey?: string;
  facilitatorUrl: string;
  facilitatorBearerToken?: string;
  trustedFeeSponsor?: string;
  allowLocalHttp: boolean;
  maxFeeLamports?: number;
}
export interface PaymentIdentity {
  intentId: string;
  requestId: string;
  canonicalHash: string;
  url: string;
  body: string;
  tool: ToolName;
  requirements: PaymentRequirements;
}
