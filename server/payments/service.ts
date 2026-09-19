import { readFile } from 'node:fs/promises';
import type { Express } from 'express';
import {
  createKeyPairSignerFromBytes,
  getBase58Decoder,
  type TransactionPartialSigner,
} from '@solana/kit';
import { x402Client } from '@x402/core/client';
import { x402HTTPClient } from '@x402/fetch';
import type { FacilitatorClient } from '@x402/core/server';
import { ExactSvmScheme } from '@x402/svm/exact/client';
import { decodePaymentRequiredHeader, decodePaymentResponseHeader } from '@x402/core/http';
import type { PaymentPayload, SchemeNetworkClient, SettleResponse } from '@x402/core/types';
import {
  appendPaymentIdentifierToExtensions,
  isValidPaymentId,
} from '@x402/extensions/payment-identifier';
import {
  CATALOG,
  PAYMENT_CHAINS,
  isBase58Bytes,
  type ReadinessItem,
  type ToolName,
} from '../../shared/domain.js';
import { createMerchant, getMerchantRecord, recordRecoveredSettlement } from '../merchant/http.js';
import type {
  DataTools,
  PaymentConfig,
  PaymentIdentity,
  PaymentLedger,
  SigningEvidence,
} from './contracts.js';
import {
  canonicalRequest,
  decodePaymentTransaction,
  paymentMemo,
  PaymentError,
  sha256,
  validateOrigin,
  validateRequirements,
  validateTransaction,
  verifyPayerSignature,
} from './guard.js';
import { boundedJson, PaymentRpc } from './rpc.js';
import { snapshotIncludesSignature, validateToolResult } from '../../shared/tool-results.js';
import { pendingRestore } from '../db/recovery.js';
import { createBoundedFacilitatorClient, settlementResponseSchema } from './facilitator.js';

export { canonicalRequest, PaymentError } from './guard.js';
export interface PaymentReadiness {
  ready: boolean;
  items: ReadinessItem[];
  payer: string | null;
  balance: { usdc: string | null; sol: string | null };
}
export interface PaymentService {
  mountMerchant(app: Express): void;
  runPaidTool(runId: string, requestId: string, tool: ToolName, args: unknown): Promise<unknown>;
  reconcile(): Promise<void>;
  readiness(): Promise<PaymentReadiness>;
}
/** Explicit adapters are an in-process test seam. HTTP callers cannot supply them. */
export interface PaymentAdapters {
  signer?: TransactionPartialSigner;
  facilitator?: FacilitatorClient;
  rpc?: PaymentRpc;
  fetch?: typeof fetch;
  scheme?: (signer: TransactionPartialSigner, identity: PaymentIdentity) => SchemeNetworkClient;
}
interface ReplayRow {
  intent_id: string;
  request_id: string;
  canonical_hash: string;
  url: string;
  body: string;
  tool: ToolName;
  amount: string;
  requirements_json: string;
  payload_json: string | null;
  attempts: number;
}
export async function createPaymentService(
  config: PaymentConfig,
  ledger: PaymentLedger,
  data: DataTools,
  adapters: PaymentAdapters = {}
): Promise<PaymentService> {
  const { db } = ledger;
  const chain = PAYMENT_CHAINS[config.network];
  db.exec(`CREATE TABLE IF NOT EXISTS buyer_replays (
    intent_id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, canonical_hash TEXT NOT NULL,
    url TEXT NOT NULL, body TEXT NOT NULL, tool TEXT NOT NULL, amount TEXT NOT NULL,
    requirements_json TEXT NOT NULL, payload_json TEXT, attempts INTEGER NOT NULL DEFAULT 0,
    done INTEGER NOT NULL DEFAULT 0, checked_at INTEGER NOT NULL DEFAULT 0
  ) STRICT;`);
  const columns = db.prepare('PRAGMA table_info(buyer_replays)').all() as { name: string }[];
  for (const name of ['done', 'checked_at'])
    if (!columns.some((column) => column.name === name))
      db.exec(`ALTER TABLE buyer_replays ADD COLUMN ${name} INTEGER NOT NULL DEFAULT 0`);
  const origin = validateOrigin(config.merchantOrigin, config.allowLocalHttp);
  const facilitatorUrl = new URL(config.facilitatorUrl);
  if (facilitatorUrl.protocol !== 'https:' || facilitatorUrl.username || facilitatorUrl.password)
    throw new PaymentError('facilitator', 'Facilitator must use a configured HTTPS endpoint.');
  const fetcher = adapters.fetch ?? fetch;
  const rpc =
    adapters.rpc ?? new PaymentRpc(config.rpcUrl ?? chain.rpcUrl, config.network, fetcher);
  if (rpc.network !== config.network)
    throw new PaymentError('network', 'Payment RPC adapter network mismatch.');
  const facilitator =
    adapters.facilitator ??
    createBoundedFacilitatorClient({
      url: config.facilitatorUrl,
      bearerToken: config.facilitatorBearerToken,
      fetch: fetcher,
    });
  let signer = adapters.signer;
  let signerError: string | undefined;
  if (config.enabled && !signer && (config.keyFile || config.secretKey)) {
    try {
      const raw = config.secretKey || (await readFile(config.keyFile!, 'utf8'));
      const key: unknown = JSON.parse(raw);
      if (
        !Array.isArray(key) ||
        key.length !== 64 ||
        key.some((v) => !Number.isInteger(v) || v < 0 || v > 255)
      )
        throw new Error('Invalid keypair.');
      const bytes = Uint8Array.from(key as number[]);
      try {
        signer = await createKeyPairSignerFromBytes(bytes);
      } finally {
        bytes.fill(0);
      }
    } catch {
      signerError =
        'Dedicated keypair must be a valid 64-byte JSON array in the configured backend secret source.';
    }
  }
  let cached: { at: number; value: PaymentReadiness } | undefined;
  let checking: Promise<PaymentReadiness> | undefined;
  async function computeReadiness(): Promise<PaymentReadiness> {
    const items: ReadinessItem[] = [
      {
        name: `${config.network} opt-in`,
        ready: config.enabled,
        detail: config.enabled
          ? `${config.network} signing is explicitly enabled.`
          : 'LIVE_PAYMENTS_ENABLED is false; rehearsal never signs.',
      },
      {
        name: 'Signer boundary',
        ready: !!signer,
        detail: signer
          ? 'Server-managed dedicated signer loaded.'
          : (signerError ??
            'Set PAYER_SECRET_FILE or PAYER_SECRET_JSON for a dedicated low-balance payer.'),
      },
      {
        name: 'Separate recipient',
        ready:
          !!config.recipient &&
          isBase58Bytes(config.recipient, 32) &&
          config.recipient !== signer?.address,
        detail: 'MERCHANT_RECIPIENT must be a different valid Solana address.',
      },
      {
        name: 'Pinned sponsor',
        ready:
          !!config.trustedFeeSponsor &&
          isBase58Bytes(config.trustedFeeSponsor, 32) &&
          config.trustedFeeSponsor !== signer?.address,
        detail: 'TRUSTED_FEE_PAYER must match the facilitator and differ from the token owner.',
      },
    ];
    let balance: { usdc: string | null; sol: string | null } = { usdc: null, sol: null };
    if (items.every((item) => item.ready) && signer) {
      const checks = await Promise.allSettled([
        facilitator.getSupported(),
        rpc.preflight(String(signer.address), config.recipient!),
      ]);
      const supported = checks[0];
      if (supported.status === 'fulfilled') {
        const kind = supported.value.kinds.find(
          (k) => k.x402Version === 2 && k.scheme === 'exact' && k.network === chain.network
        );
        const ready = kind?.extra?.feePayer === config.trustedFeeSponsor;
        items.push({
          name: 'Facilitator',
          ready,
          detail: ready
            ? `Advertises v2 exact Solana ${config.network} with the pinned fee sponsor. Settlement has not been tested by this read.`
            : `Facilitator does not advertise exact ${config.network} with the pinned fee sponsor.`,
        });
      } else
        items.push({
          name: 'Facilitator',
          ready: false,
          detail: 'Supported preflight failed; verify access/authentication and availability.',
        });
      const chainCheck = checks[1];
      if (chainCheck.status === 'fulfilled') {
        const lamports = BigInt(chainCheck.value.sol);
        balance = {
          usdc: chainCheck.value.usdc,
          sol: `${lamports / 1_000_000_000n}.${String(lamports % 1_000_000_000n).padStart(9, '0')}`,
        };
        items.push({
          name: `${config.network} mint and accounts`,
          ready: true,
          detail:
            'RPC genesis, SPL mint ownership, six decimals, and both USDC associated accounts verified. Sponsor pays bounded SOL fees; account creation is not included.',
        });
        items.push({
          name: 'USDC funding',
          ready: BigInt(chainCheck.value.usdc) >= 10000n,
          detail: `Payer has ${chainCheck.value.usdc} micro-USDC on ${config.network}. SOL balance is ${chainCheck.value.sol} lamports; fee sponsor is a separate account.`,
        });
      } else
        items.push({
          name: `${config.network} mint and accounts`,
          ready: false,
          detail:
            chainCheck.reason instanceof PaymentError
              ? chainCheck.reason.message
              : 'RPC/account preflight failed. Create and fund both configured USDC associated token accounts first.',
        });
    }
    return {
      ready: items.every((item) => item.ready),
      items,
      payer: signer ? String(signer.address) : null,
      balance,
    };
  }
  async function readiness(): Promise<PaymentReadiness> {
    if (cached && Date.now() - cached.at < 30_000) return cached.value;
    if (!checking)
      checking = computeReadiness()
        .then((value) => {
          cached = { at: Date.now(), value };
          return value;
        })
        .finally(() => {
          checking = undefined;
        });
    return checking;
  }
  const merchant =
    config.recipient && config.trustedFeeSponsor
      ? createMerchant({
          db,
          network: config.network,
          origin,
          recipient: config.recipient,
          sponsor: config.trustedFeeSponsor,
          facilitator,
          data,
          isReady: async () => (await readiness()).ready,
        })
      : undefined;
  function replayRow(id: string) {
    return db.prepare('SELECT * FROM buyer_replays WHERE intent_id=?').get(id) as
      ReplayRow | undefined;
  }
  function assertReplayNetwork(row: ReplayRow) {
    const terms = JSON.parse(row.requirements_json) as {
      network?: string;
      asset?: string;
      payTo?: string;
      amount?: string;
      extra?: { feePayer?: string };
    };
    const intent = ledger.getIntent(row.intent_id);
    const saved = db.prepare('SELECT policy FROM runs WHERE id=?').get(intent?.runId) as
      { policy: string } | undefined;
    const policy = saved
      ? (JSON.parse(saved.policy) as {
          network: string;
          mint: string;
          recipient: string;
          origin: string;
        })
      : undefined;
    const accepted = row.payload_json
      ? (JSON.parse(row.payload_json) as PaymentPayload).accepted
      : undefined;
    if (
      !policy ||
      policy.network !== terms.network ||
      policy.mint !== terms.asset ||
      policy.recipient !== terms.payTo ||
      policy.origin !== origin ||
      terms.network !== chain.network ||
      terms.asset !== chain.mint ||
      terms.payTo !== config.recipient ||
      terms.amount !== row.amount ||
      terms.extra?.feePayer !== config.trustedFeeSponsor ||
      new URL(row.url).origin !== origin ||
      (accepted &&
        (accepted.network !== terms.network ||
          accepted.asset !== terms.asset ||
          accepted.payTo !== terms.payTo ||
          accepted.amount !== terms.amount ||
          accepted.extra?.feePayer !== terms.extra?.feePayer))
    )
      throw new PaymentError(
        'network',
        'This purchase belongs to its original network, recipient and origin. Restore that configuration to reconcile it.',
        row.intent_id
      );
  }
  const makeHttp = () => new x402HTTPClient(new x402Client());
  async function request(
    url: string,
    body: string,
    id: string,
    payment?: PaymentPayload
  ): Promise<Response> {
    const u = new URL(url);
    if (
      u.origin !== origin ||
      !CATALOG.some((tool) => tool.path === u.pathname) ||
      u.search ||
      u.hash
    )
      throw new PaymentError('destination', 'Paid HTTP destination is not allowlisted.');
    const paymentHeaders = payment ? makeHttp().encodePaymentSignatureHeader(payment) : {};
    return fetcher(url, {
      method: 'POST',
      body,
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'x-payment-id': id,
        ...paymentHeaders,
      },
      redirect: 'error',
      signal: AbortSignal.timeout(25_000),
    });
  }
  async function consume(row: ReplayRow, response: Response): Promise<unknown> {
    assertReplayNetwork(row);
    const header = response.headers.get('payment-response');
    let settlement: SettleResponse | undefined;
    let chainVerified = false;
    if (header && header.length <= 8192) {
      try {
        settlement = settlementResponseSchema.parse(decodePaymentResponseHeader(header));
      } catch {
        throw new PaymentError('settlement-unknown', 'Invalid settlement receipt.', row.intent_id);
      }
      if (
        settlement.success &&
        settlement.network === chain.network &&
        isBase58Bytes(settlement.transaction, 64)
      ) {
        ledger.markSettled(row.intent_id, {
          signature: settlement.transaction,
          chainVerified: false,
          feeSponsor: config.trustedFeeSponsor,
          note: 'Facilitator settlement reported; independent RPC proof pending.',
        });
        if (row.payload_json) {
          try {
            const proof = await rpc.evidence(
              settlement.transaction,
              JSON.parse(row.payload_json) as PaymentPayload,
              row.amount,
              config.recipient!
            );
            if (proof) {
              ledger.markSettled(row.intent_id, proof);
              chainVerified = true;
            }
          } catch {
            /* Keep reported settlement, with chainVerified false. Reconciliation retries the proof. */
          }
        }
      } else settlement = undefined;
    }
    if (!settlement?.success) {
      ledger.markUnknown(
        row.intent_id,
        'No trustworthy settlement success receipt; the original payment remains held.'
      );
      throw new PaymentError(
        'settlement-unknown',
        'Payment outcome is unknown. Reconciliation retains the same payment identity.',
        row.intent_id
      );
    }
    try {
      const result = await boundedJson(response, 100_000);
      if (!response.ok) {
        ledger.markResultUnavailable(
          row.intent_id,
          'Merchant reports settled payment but result delivery failed.'
        );
        throw new PaymentError(
          'result-unavailable',
          'Payment settled, but its result is unavailable.',
          row.intent_id
        );
      }
      const intent = ledger.getIntent(row.intent_id)!;
      const validated = validateToolResult(
        row.tool,
        result,
        JSON.parse(row.body),
        ledger.getRun(intent.runId).dataNetwork
      );
      ledger.markDelivered(row.intent_id, validated);
      if (chainVerified)
        db.prepare('UPDATE buyer_replays SET done=1 WHERE intent_id=?').run(row.intent_id);
      cached = undefined;
      return validated;
    } catch (error) {
      ledger.markResultUnavailable(
        row.intent_id,
        'Payment settled; response was lost or could not be read.'
      );
      throw error instanceof PaymentError
        ? error
        : new PaymentError(
            'result-unavailable',
            'Payment settled, but its response was lost. Recover the same purchase.',
            row.intent_id
          );
    }
  }
  async function recover(row: ReplayRow): Promise<unknown> {
    assertReplayNetwork(row);
    const intent = ledger.getIntent(row.intent_id);
    if (intent?.status === 'delivered') return intent.result;
    if (!row.payload_json)
      throw new PaymentError(
        'settlement-unknown',
        'Signing was interrupted. No replacement payment will be created.',
        row.intent_id
      );
    const claim = db
      .prepare(
        'UPDATE buyer_replays SET attempts=attempts+1,checked_at=? WHERE intent_id=? AND attempts<4'
      )
      .run(Date.now(), row.intent_id);
    if (claim.changes !== 1)
      throw new PaymentError(
        'recovery-limit',
        'Automatic recovery limit reached; retain the payment hold and inspect evidence.',
        row.intent_id
      );
    const payload = JSON.parse(row.payload_json) as PaymentPayload;
    const receipt = getMerchantRecord(db, row.request_id);
    if (receipt && receipt.status !== 'settled') {
      const proof = await rpc.findSettlement(payload, row.amount, config.recipient!);
      if (proof) {
        ledger.markSettled(row.intent_id, proof);
        recordRecoveredSettlement(db, row.request_id, {
          success: true,
          transaction: proof.signature,
          network: chain.network,
          payer: proof.feeSponsor,
        });
      }
    }
    // Exact same payload only. Never create a fresh signature during recovery, even after Stop.
    return consume(row, await request(row.url, row.body, row.request_id, payload));
  }
  async function runPaidTool(
    runId: string,
    requestId: string,
    tool: ToolName,
    args: unknown
  ): Promise<unknown> {
    const canonical = canonicalRequest(tool, args, origin);
    if (!isValidPaymentId(requestId))
      throw new PaymentError('request-id', 'A stable 16–128 character request ID is required.');
    const priorById = db
      .prepare('SELECT * FROM buyer_replays WHERE request_id=?')
      .get(requestId) as ReplayRow | undefined;
    if (
      priorById &&
      (priorById.canonical_hash !== canonical.hash ||
        ledger.getIntent(priorById.intent_id)?.runId !== runId)
    )
      throw new PaymentError('conflict', 'Payment ID conflicts with its original run or request.');
    const prior =
      priorById ??
      (
        db
          .prepare('SELECT * FROM buyer_replays WHERE canonical_hash=?')
          .all(canonical.hash) as ReplayRow[]
      ).find((row) => ledger.getIntent(row.intent_id)?.runId === runId);
    if (prior) {
      if (!config.enabled || pendingRestore(db))
        throw new PaymentError(
          'disabled',
          'Payment transmission is disabled; use read-only reconciliation of the original payment.'
        );
      return recover(prior);
    }
    const run = ledger.getRun(runId);
    const parsedArgs = JSON.parse(canonical.body) as { address?: string; signature?: string };
    if (
      (tool === 'wallet_snapshot' && parsedArgs.address !== run.wallet) ||
      (tool === 'transaction_explain' && !snapshotIncludesSignature(run, parsedArgs.signature!))
    )
      throw new PaymentError(
        'policy-mismatch',
        'Tool arguments are outside the frozen wallet and delivered snapshot.'
      );
    const state = await readiness();
    if (!state.ready || !signer)
      throw new PaymentError(
        'unavailable',
        'Live payments are unavailable. Complete the configured network readiness checklist.'
      );
    const catalog = CATALOG.find((item) => item.name === tool)!;
    const unpaid = await request(canonical.url, canonical.body, requestId);
    if (unpaid.status !== 402) {
      await unpaid.body?.cancel();
      throw new PaymentError(
        'challenge',
        'Merchant did not return a genuine 402 payment challenge.'
      );
    }
    const encoded = unpaid.headers.get('payment-required');
    await unpaid.body?.cancel();
    if (!encoded || encoded.length > 16384)
      throw new PaymentError('challenge', 'Missing or excessive v2 payment requirements.');
    const required = decodePaymentRequiredHeader(encoded);
    const expected = {
      url: canonical.url,
      amount: catalog.price,
      recipient: config.recipient!,
      sponsor: config.trustedFeeSponsor!,
      memo: paymentMemo(requestId, canonical.hash),
      network: chain.network,
      mint: chain.mint,
    };
    const requirements = validateRequirements(required, expected);
    const reservation = ledger.reserve({
      runId,
      requestId,
      canonicalHash: canonical.hash,
      tool,
      amount: catalog.price,
      origin,
      path: canonical.path,
      method: 'POST',
      recipient: config.recipient!,
      network: chain.network,
      mint: chain.mint,
    });
    const { intent } = reservation;
    if (!reservation.created) {
      if (intent.status === 'delivered') return intent.result;
      const existing = replayRow(intent.id);
      if (existing) return recover(existing);
      throw new PaymentError(
        'duplicate',
        'Purchase already exists and cannot be signed again.',
        intent.id
      );
    }
    const identity: PaymentIdentity = {
      intentId: intent.id,
      requestId,
      canonicalHash: canonical.hash,
      url: canonical.url,
      body: canonical.body,
      tool,
      requirements,
    };
    let enteredSigning = false;
    let signingClosed = false;
    const deadline = Date.now() + 25_000;
    let signingEvidence: SigningEvidence | undefined;
    let payerSignature: string | undefined;
    try {
      db.prepare(
        'INSERT INTO buyer_replays(intent_id,request_id,canonical_hash,url,body,tool,amount,requirements_json) VALUES(?,?,?,?,?,?,?,?)'
      ).run(
        intent.id,
        requestId,
        canonical.hash,
        canonical.url,
        canonical.body,
        tool,
        catalog.price,
        JSON.stringify(requirements)
      );
      const key = signer;
      const guardedSigner: TransactionPartialSigner = {
        address: key.address,
        signTransactions: async (transactions, signerConfig) => {
          if (transactions.length !== 1 || enteredSigning || signingClosed || Date.now() > deadline)
            throw new PaymentError('signer-denied', 'Signing scope is closed.', intent.id);
          validateRequirements(required, expected);
          const tx = transactions[0];
          const message = Uint8Array.from(tx.messageBytes);
          const decoded = await validateTransaction(message, {
            payer: String(key.address),
            sponsor: config.trustedFeeSponsor!,
            recipient: config.recipient!,
            amount: catalog.price,
            mint: chain.mint,
            memo: expected.memo,
          });
          await rpc.validateLifetimeAndFee(
            message,
            decoded.blockhash,
            config.maxFeeLamports ?? 15_000
          );
          if (signingClosed || Date.now() > deadline)
            throw new PaymentError(
              'expired',
              'Payment construction exceeded its deadline.',
              intent.id
            );
          ledger.checkBeforeSign(intent.id);
          signingEvidence = {
            messageHash: decoded.messageHash,
            blockhash: decoded.blockhash,
            payer: String(key.address),
            feeSponsor: config.trustedFeeSponsor!,
          };
          ledger.markSigning(intent.id, signingEvidence);
          enteredSigning = true;
          const signingTransaction = Object.freeze({
            ...tx,
            messageBytes: Uint8Array.from(message) as unknown as typeof tx.messageBytes,
          });
          const signatures = await key.signTransactions([signingTransaction], signerConfig);
          const sig = signatures[0]?.[key.address];
          if (!sig)
            throw new PaymentError(
              'signature',
              'Signer did not return the required signature.',
              intent.id
            );
          payerSignature = getBase58Decoder().decode(sig);
          return signatures;
        },
      };
      const scheme =
        adapters.scheme?.(guardedSigner, identity) ??
        new ExactSvmScheme(guardedSigner, { rpcUrl: rpc.url });
      const client = new x402Client().register(chain.network, scheme).setSpendControls({
        maxAmountPerPayment: '$0.020000',
        allowedAssets: [
          { network: chain.network, asset: chain.mint, maxAmountPerPayment: catalog.price },
        ],
      });
      client.onBeforePaymentCreation(async (context) => {
        validateRequirements(context.paymentRequired, expected);
        if (JSON.stringify(context.selectedRequirements) !== JSON.stringify(requirements))
          throw new PaymentError('changed-terms', 'Selected payment terms changed.');
        ledger.checkBeforeSign(intent.id);
        appendPaymentIdentifierToExtensions(context.paymentRequired.extensions!, requestId);
      });
      let timer: ReturnType<typeof setTimeout> | undefined;
      const payload = await Promise.race([
        client.createPaymentPayload(required),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            signingClosed = true;
            reject(
              new PaymentError(
                'construction-timeout',
                'Payment SDK construction exceeded its bounded deadline.',
                intent.id
              )
            );
          }, 25_000);
        }),
      ]).finally(() => {
        if (timer) clearTimeout(timer);
      });
      if (!signingEvidence || !payerSignature || !enteredSigning)
        throw new PaymentError('unsigned', 'No guarded payer signature was produced.', intent.id);
      const final = decodePaymentTransaction(payload);
      await validateTransaction(final.message, {
        payer: String(key.address),
        sponsor: config.trustedFeeSponsor!,
        recipient: config.recipient!,
        amount: catalog.price,
        mint: chain.mint,
        memo: expected.memo,
      });
      if (
        sha256(final.message) !== signingEvidence.messageHash ||
        getBase58Decoder().decode(final.signatures[1]) !== payerSignature ||
        verifyPayerSignature(payload) !== String(key.address)
      )
        throw new PaymentError('payload-changed', 'Signed payment identity changed.', intent.id);
      // Persist before the only paid HTTP retry. Both journals use the same persistent SQLite DB.
      db.transaction(() => {
        ledger.markSigned(intent.id, {
          ...signingEvidence!,
          payerSignature: payerSignature!,
          payload,
        });
        db.prepare('UPDATE buyer_replays SET payload_json=? WHERE intent_id=?').run(
          JSON.stringify(payload),
          intent.id
        );
      }).immediate();
      ledger.markSubmitted(intent.id);
      return await consume(
        replayRow(intent.id)!,
        await request(canonical.url, canonical.body, requestId, payload)
      );
    } catch (error) {
      signingClosed = true;
      if (enteredSigning)
        ledger.markUnknown(
          intent.id,
          'Signed payment requires reconciliation; no fresh payment may be created.'
        );
      else ledger.rejectUnsigned(intent.id, 'Payment was rejected before signing.');
      throw error instanceof PaymentError
        ? error
        : new PaymentError(
            'payment-failed',
            'Payment could not complete. Check the durable receipt before retrying.',
            intent.id
          );
    }
  }
  let reconciling: Promise<void> | undefined;
  async function observe(row: ReplayRow) {
    const intent = ledger.getIntent(row.intent_id);
    if (!intent || !row.payload_json) return;
    const claim = db
      .prepare('UPDATE buyer_replays SET checked_at=? WHERE intent_id=? AND checked_at<=?')
      .run(Date.now(), row.intent_id, Date.now() - 30_000);
    if (claim.changes !== 1) return;
    const payload = JSON.parse(row.payload_json) as PaymentPayload;
    const proof = intent.signature
      ? await rpc.evidence(intent.signature, payload, row.amount, config.recipient!)
      : await rpc.findSettlement(payload, row.amount, config.recipient!);
    if (!proof) return; // A miss never frees held allowance or authorizes another identity.
    ledger.markSettled(row.intent_id, proof);
    const receipt = getMerchantRecord(db, row.request_id);
    if (receipt)
      recordRecoveredSettlement(db, row.request_id, {
        success: true,
        transaction: proof.signature,
        network: chain.network,
        payer: proof.feeSponsor,
      });
    if (intent.status !== 'delivered' && receipt?.result_json) {
      const result = validateToolResult(
        row.tool,
        JSON.parse(receipt.result_json),
        JSON.parse(row.body),
        ledger.getRun(intent.runId).dataNetwork
      );
      ledger.markDelivered(row.intent_id, result);
    }
    if (ledger.getIntent(row.intent_id)?.status === 'delivered')
      db.prepare('UPDATE buyer_replays SET done=1 WHERE intent_id=?').run(row.intent_id);
  }
  async function reconcileOnce(): Promise<void> {
    if (!config.recipient) return;
    const observationOnly = !config.enabled || Boolean(pendingRestore(db));
    const rows = db
      .prepare(
        "SELECT * FROM buyer_replays WHERE done=0 AND payload_json IS NOT NULL AND json_valid(requirements_json) AND json_extract(requirements_json,'$.network')=? AND json_extract(requirements_json,'$.asset')=? AND json_extract(requirements_json,'$.payTo')=? AND json_extract(requirements_json,'$.extra.feePayer')=? AND url IN (?,?) ORDER BY checked_at,intent_id LIMIT 20"
      )
      .all(
        chain.network,
        chain.mint,
        config.recipient,
        config.trustedFeeSponsor,
        ...CATALOG.map((tool) => new URL(tool.path, origin).href)
      ) as ReplayRow[];
    for (const row of rows) {
      // A configuration change must never replay a historical payment on another cluster.
      try {
        assertReplayNetwork(row);
      } catch {
        db.prepare('UPDATE buyer_replays SET checked_at=? WHERE intent_id=?').run(
          Date.now(),
          row.intent_id
        );
        continue;
      }
      const intent = ledger.getIntent(row.intent_id);
      if (!intent) continue;
      if (observationOnly || row.attempts >= 4 || intent.status === 'delivered') {
        try {
          await observe(row);
        } catch {
          /* Preserve original holds and evidence when observation or cached delivery is unavailable. */
        }
        continue;
      }
      if (
        [
          'reserved',
          'submitted',
          'settlement-unknown',
          'settled',
          'settled-but-result-unavailable',
        ].includes(intent.status) &&
        row.payload_json
      ) {
        try {
          await recover(row);
        } catch {
          /* Conservative hold is intentional; reconciliation never generates a new payment. */
        }
      }
    }
  }
  function reconcile(): Promise<void> {
    return (reconciling ??= reconcileOnce().finally(() => {
      reconciling = undefined;
    }));
  }
  return {
    runPaidTool,
    reconcile,
    readiness,
    mountMerchant(app) {
      if (merchant) merchant.mount(app);
      else
        for (const tool of CATALOG)
          app.post(tool.path, (_req, res) => {
            res.status(503).json({ error: 'Merchant payments are not configured.' });
          });
    },
  };
}
