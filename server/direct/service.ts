import type { KeyPairSigner } from '@solana/kit';
import { PAYMENT_CHAINS, type PaymentNetwork, type ReadinessItem } from '../../shared/domain.js';
import type { DirectPaymentDTO, DirectPaymentRequest } from '../../shared/mandate.js';
import type { Config } from '../config.js';
import { PaymentError } from '../payments/guard.js';
import { PaymentRpc } from '../payments/rpc.js';
import { loadPayerSigner } from '../payments/keypair.js';
import type { Ledger } from '../policy/ledger.js';
import type { MandateLedger, SignedIdentity } from './ledger.js';
import {
  ACCOUNT_CREATION_LAMPORTS,
  blockHeight,
  composeTransfer,
  fetchLanded,
  inspectLandedTransaction,
  readTransferPreconditions,
  signatureStatus,
  signTransfer,
  type DirectRpc,
} from './transfer.js';

export interface DirectReadiness {
  ready: boolean;
  items: ReadinessItem[];
  payer: string | null;
  network: PaymentNetwork;
  balance: { usdc: string | null; sol: string | null };
}
export interface DirectPaymentService {
  readonly enabled: boolean;
  readonly payer: string | null;
  readiness(): Promise<DirectReadiness>;
  pay(mandateId: string, request: DirectPaymentRequest, source: DirectPaymentDTO['source']): Promise<DirectPaymentDTO>;
  reconcile(): Promise<void>;
}
export interface DirectAdapters {
  rpc?: DirectRpc;
  signer?: KeyPairSigner;
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  confirmTimeoutMs?: number;
  pollMs?: number;
}
const MIN_PAYER_LAMPORTS = 5_000_000n;
const simulationSchema = {
  parse(value: unknown) {
    const result = (value as { value?: { err?: unknown; logs?: unknown } } | null)?.value;
    if (!result || typeof result !== 'object' || !Object.hasOwn(result, 'err'))
      throw new PaymentError('simulation', 'Simulation returned no explicit outcome.');
    return { err: result.err };
  },
};

/**
 * Direct payments: the payer signs and submits its own TransferChecked, so the
 * service owns every step the facilitator owns on the x402 rail. Nothing here
 * is reachable unless DIRECT_PAYMENTS_ENABLED is set and a payer key is loaded,
 * and every state change is written to the mandate ledger before the next step.
 */
export async function createDirectPaymentService(
  config: Config,
  ledgers: { ledger: Ledger; mandates: MandateLedger },
  adapters: DirectAdapters = {}
): Promise<DirectPaymentService> {
  const chain = PAYMENT_CHAINS[config.paymentNetwork];
  const now = adapters.now ?? Date.now;
  const sleep = adapters.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const confirmTimeoutMs = adapters.confirmTimeoutMs ?? 25_000;
  const pollMs = adapters.pollMs ?? 1_500;
  const rpc: DirectRpc =
    adapters.rpc ?? new PaymentRpc(config.paymentRpcUrl, config.paymentNetwork, adapters.fetch ?? fetch);
  let signer = adapters.signer;
  let signerError: string | undefined;
  if (config.directEnabled && !signer && (config.payerSecretFile || config.payerSecretJson)) {
    try {
      signer = await loadPayerSigner({ keyFile: config.payerSecretFile, secretKey: config.payerSecretJson });
    } catch {
      signerError = 'Dedicated keypair must be a valid 64-byte JSON array in the configured backend secret source.';
    }
  }
  const enabled = config.directEnabled && Boolean(signer);
  const payer = signer ? String(signer.address) : null;
  const { ledger, mandates } = ledgers;

  async function readiness(): Promise<DirectReadiness> {
    const items: ReadinessItem[] = [
      {
        name: 'Direct payments opt-in',
        ready: config.directEnabled,
        detail: config.directEnabled
          ? `${config.paymentNetwork} direct transfers are explicitly enabled.`
          : 'DIRECT_PAYMENTS_ENABLED is false; mandates cannot move USDC.',
      },
      {
        name: 'Payer signer',
        ready: Boolean(signer),
        detail: signer
          ? 'Server-managed dedicated signer loaded.'
          : (signerError ?? 'Set PAYER_SECRET_FILE or PAYER_SECRET_JSON for a dedicated low-balance payer.'),
      },
      {
        name: 'Recipient approvals',
        ready: true,
        detail: config.adminPublicKey
          ? `Later recipients require a signature from ${config.adminPublicKey}.`
          : 'No ADMIN_PUBLIC_KEY configured: recipients are fixed when a mandate is authorized.',
      },
    ];
    let balance: DirectReadiness['balance'] = { usdc: null, sol: null };
    if (signer) {
      try {
        await rpc.assertNetwork();
        items.push({ name: 'Payment RPC', ready: true, detail: `Verified Solana ${config.paymentNetwork} genesis hash.` });
        // A read against the payer's own account only; no recipient is involved yet.
        const pre = await readTransferPreconditions(rpc, payer!, payer!, chain.mint).catch((error: unknown) => {
          throw error instanceof PaymentError ? error : new PaymentError('rpc-unavailable', 'Payment RPC read failed.');
        });
        balance = { usdc: String(pre.payerUsdc), sol: String(pre.payerLamports) };
        items.push(
          {
            name: 'Payer USDC account',
            ready: true,
            detail: `Initialized ${config.paymentNetwork} USDC account holds ${pre.payerUsdc} micro-USDC.`,
          },
          {
            name: 'Payer SOL',
            ready: pre.payerLamports >= MIN_PAYER_LAMPORTS,
            detail:
              pre.payerLamports >= MIN_PAYER_LAMPORTS
                ? `${pre.payerLamports} lamports available for fees and recipient accounts.`
                : `Fund the payer with at least ${MIN_PAYER_LAMPORTS} lamports for fees and recipient accounts.`,
          }
        );
      } catch (error) {
        items.push({
          name: 'Payment RPC',
          ready: false,
          detail:
            error instanceof PaymentError && error.code === 'payer-account'
              ? `The payer has no initialized ${config.paymentNetwork} USDC account yet.`
              : `The ${config.paymentNetwork} payment RPC could not be verified.`,
        });
      }
    }
    if (ledger.payerFrozen())
      items.push({
        name: 'Payment recovery',
        ready: false,
        detail: 'An uncertain payment holds this payer. Reconcile before new mandates or payments.',
      });
    return { ready: items.every((item) => item.ready), items, payer, network: config.paymentNetwork, balance };
  }

  function paymentOnConfiguredNetwork(id: string): DirectPaymentDTO {
    const payment = mandates.getPayment(id);
    if (!payment || payment.paymentNetwork !== config.paymentNetwork || payment.mint !== chain.mint)
      throw new PaymentError('network', 'Recovery requires the payment’s original network and USDC mint.', id);
    return payment;
  }

  /** Reads back chain state for one signed payment and settles, fails or expires it; returns true when resolved. */
  async function resolve(id: string, identity: SignedIdentity): Promise<boolean> {
    const payment = paymentOnConfiguredNetwork(id);
    if (!identity.signature) return false;
    const status = await signatureStatus(rpc, identity.signature, true);
    if (status.state === 'confirmed' || status.state === 'failed') {
      const landed = inspectLandedTransaction(await fetchLanded(rpc, identity.signature), {
        signature: identity.signature,
        messageHash: identity.messageHash,
        source: identity.source,
        destination: identity.destination,
        payer: identity.payer,
        recipient: payment.recipient,
        mint: chain.mint,
        amount: BigInt(payment.amount),
        createdRecipientAccount: identity.createRecipientAccount,
        maxFeeLamports: config.directMaxFeeLamports,
        now: now(),
      });
      if (!landed) return false;
      if (landed.outcome === 'settled') mandates.markSettled(id, landed.evidence);
      else if (landed.outcome === 'failed')
        mandates.markNotSettled(id, 'failed', `The transaction landed with an error: ${landed.error}`, {
          signature: identity.signature,
          slot: landed.slot,
          error: landed.error,
        });
      else mandates.markUnknown(id, landed.detail);
      return true;
    }
    if (status.state === 'unknown') {
      const height = await blockHeight(rpc);
      if (height > BigInt(identity.lastValidBlockHeight)) {
        // The blockhash can no longer be included; a second history-aware read guards a race.
        const again = await signatureStatus(rpc, identity.signature, true);
        if (again.state === 'unknown') {
          mandates.markNotSettled(id, 'expired', 'The signed transaction was never included before its blockhash expired.', {
            signature: identity.signature,
            lastValidBlockHeight: identity.lastValidBlockHeight,
            observedBlockHeight: String(height),
          });
          return true;
        }
      }
    }
    return false;
  }

  async function submit(id: string, wire: string, signature: string) {
    const sent = await rpc.call('sendTransaction', [
      wire,
      { encoding: 'base64', preflightCommitment: 'confirmed', maxRetries: 3 },
    ]);
    if (sent !== signature) throw new PaymentError('submit', 'Payment RPC returned a different signature.');
    mandates.markSubmitted(id);
  }

  async function pay(mandateId: string, request: DirectPaymentRequest, source: DirectPaymentDTO['source']) {
    const { created, payment } = mandates.reserve(mandateId, request, source);
    if (!created || payment.status !== 'reserved') return payment;
    const id = payment.id;
    if (!enabled || !signer) {
      mandates.releaseUnsigned(id, 'Direct payments are not enabled on this service.');
      throw new PaymentError('disabled', 'Direct payments are not enabled; no transfer was signed.', id);
    }
    let pre;
    try {
      pre = await readTransferPreconditions(rpc, payer!, payment.recipient, chain.mint);
    } catch (error) {
      mandates.releaseUnsigned(id, 'Payment RPC preconditions could not be read.');
      throw error instanceof PaymentError ? error : new PaymentError('rpc-unavailable', 'Payment RPC read failed.', id);
    }
    const amount = BigInt(payment.amount);
    const creation = pre.recipientAccountExists ? 0n : ACCOUNT_CREATION_LAMPORTS;
    if (pre.payerUsdc < amount) {
      mandates.releaseUnsigned(id, 'The payer USDC balance is below the approved amount.');
      throw new PaymentError('insufficient-usdc', 'The payer USDC balance is below the approved amount.', id);
    }
    if (creation > BigInt(config.directMaxAccountCreationLamports)) {
      mandates.releaseUnsigned(id, 'Creating the recipient account exceeds the SOL bound.');
      throw new PaymentError('account-creation', 'Creating the recipient account exceeds the SOL bound.', id);
    }
    if (pre.payerLamports < BigInt(config.directMaxFeeLamports) + creation) {
      mandates.releaseUnsigned(id, 'The payer SOL balance cannot cover fees.');
      throw new PaymentError('insufficient-sol', 'The payer SOL balance cannot cover fees.', id);
    }
    let composed: Awaited<ReturnType<typeof composeTransfer>>;
    try {
      composed = await composeTransfer({
        paymentId: id,
        signer,
        recipient: payment.recipient,
        mint: chain.mint,
        amount,
        memo: payment.memo,
        createRecipientAccount: !pre.recipientAccountExists,
        blockhash: pre.blockhash,
        lastValidBlockHeight: pre.lastValidBlockHeight,
        priorityFeeMicroLamports: config.directPriorityFeeMicroLamports,
      });
      const [fee, simulation] = await Promise.all([
        rpc.call('getFeeForMessage', [composed.messageBase64, { commitment: 'confirmed' }]),
        rpc.call('simulateTransaction', [
          composed.unsignedWire,
          { encoding: 'base64', sigVerify: false, commitment: 'confirmed' },
        ]),
      ]);
      const charged = (fee as { value?: number | null } | null)?.value ?? null;
      if (charged === null || !Number.isSafeInteger(charged) || charged < 0 || charged > config.directMaxFeeLamports)
        throw new PaymentError('fee-limit', 'Transaction SOL fee is unavailable or exceeds the approved bound.', id);
      if (simulationSchema.parse(simulation).err !== null)
        throw new PaymentError('simulation', 'The transfer failed simulation; nothing was signed.', id);
    } catch (error) {
      mandates.releaseUnsigned(id, error instanceof PaymentError ? error.message : 'Pre-sign checks failed.');
      throw error instanceof PaymentError ? error : new PaymentError('rpc-unavailable', 'Pre-sign checks failed.', id);
    }
    try {
      mandates.markSigning(id, {
        messageHash: composed.messageHash,
        blockhash: pre.blockhash,
        lastValidBlockHeight: String(pre.lastValidBlockHeight),
        payer: payer!,
        source: composed.source,
        destination: composed.destination,
        createRecipientAccount: !pre.recipientAccountExists,
      });
    } catch (error) {
      // Grant revocation and service-lease failures also happen before signing.
      // The ledger retains a hold if a signing claim was already persisted.
      mandates.releaseUnsigned(id, 'Signing authorization failed before signer invocation.');
      throw error;
    }
    const signed = await signTransfer(composed.message);
    if (signed.messageHash !== composed.messageHash) {
      mandates.markUnknown(id, 'Signed message differed from the claimed message.');
      throw new PaymentError('signing', 'Signed message differed from the claimed message.', id);
    }
    mandates.markSigned(id, { signature: signed.signature, wire: signed.wire });
    try {
      await submit(id, signed.wire, signed.signature);
    } catch {
      mandates.markUnknown(id, 'Submission failed; the signed transaction may or may not have reached the network.');
      return mandates.getPayment(id)!;
    }
    const identity: SignedIdentity = {
      messageHash: composed.messageHash,
      blockhash: pre.blockhash,
      lastValidBlockHeight: String(pre.lastValidBlockHeight),
      payer: payer!,
      source: composed.source,
      destination: composed.destination,
      createRecipientAccount: !pre.recipientAccountExists,
      phase: 'signed',
      signature: signed.signature,
      wire: signed.wire,
    };
    const deadline = now() + confirmTimeoutMs;
    for (;;) {
      try {
        if (await resolve(id, identity)) break;
      } catch {
        // A transient RPC failure leaves the payment submitted; the reconciler continues.
      }
      if (now() >= deadline) break;
      await sleep(pollMs);
    }
    return mandates.getPayment(id)!;
  }

  async function reconcile() {
    if (!signer) return;
    const unresolved = mandates.unresolved();
    if (unresolved.length === 0) return;
    if (rpc.network !== config.paymentNetwork)
      throw new PaymentError('network', 'Recovery RPC differs from the configured payment network.');
    // Never use a different chain's null status or block height to release a hold.
    await rpc.assertNetwork();
    for (const pending of unresolved) {
      try {
        paymentOnConfiguredNetwork(pending.id);
        const { identity } = pending;
        if (identity.phase === 'signed' && identity.wire && identity.signature && pending.status !== 'submitted') {
          // Signed, but the network never acknowledged it. While the blockhash is still
          // valid, re-broadcasting the identical bytes is idempotent: same signature,
          // same outcome, and a landing is caught by the status read below.
          const seen = await signatureStatus(rpc, identity.signature, true);
          if (seen.state === 'unknown') {
            const valid = (await rpc.call('isBlockhashValid', [identity.blockhash, { commitment: 'confirmed' }])) as { value?: boolean } | null;
            if (valid?.value === true) await submit(pending.id, identity.wire, identity.signature);
          }
        }
        await resolve(pending.id, identity);
      } catch {
        // Unresolved payments stay held; the next pass tries again.
      }
    }
  }

  return { enabled, payer, readiness, pay, reconcile };
}
