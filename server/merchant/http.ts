import type { Express, Request, Response, NextFunction } from 'express';
import type Database from 'better-sqlite3';
import { ZodError } from 'zod';
import { paymentMiddleware, x402ResourceServer } from '@x402/express';
import { ExactSvmScheme } from '@x402/svm/exact/server';
import type { FacilitatorClient, RoutesConfig } from '@x402/core/server';
import type { PaymentRequirements, SettleResponse } from '@x402/core/types';
import { decodePaymentSignatureHeader, encodePaymentResponseHeader } from '@x402/core/http';
import {
  declarePaymentIdentifierExtension,
  extractPaymentIdentifier,
  isValidPaymentId,
  paymentIdentifierResourceServerExtension,
} from '@x402/extensions/payment-identifier';
import { CATALOG, PAYMENT_NETWORK, USDC_MINT, type ToolName } from '../../shared/domain.js';
import type { DataTools } from '../payments/contracts.js';
import {
  canonicalRequest,
  decodePaymentTransaction,
  paymentMemo,
  PaymentError,
  sha256,
  validateTransaction,
  verifyPayerSignature,
} from '../payments/guard.js';

export interface MerchantRecord {
  id: string;
  canonical_hash: string;
  payload_hash: string;
  payer: string;
  status: string;
  result_json: string | null;
  settle_json: string | null;
  payload_json: string;
  requirements_json: string;
}
export function initializeMerchantStore(db: Database.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS merchant_receipts (
    id TEXT PRIMARY KEY, canonical_hash TEXT NOT NULL, payload_hash TEXT NOT NULL UNIQUE,
    payer TEXT NOT NULL, status TEXT NOT NULL, result_json TEXT, settle_json TEXT,
    payload_json TEXT NOT NULL, requirements_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) STRICT;`);
}
export function getMerchantRecord(db: Database.Database, id: string): MerchantRecord | undefined {
  return db.prepare('SELECT * FROM merchant_receipts WHERE id = ?').get(id) as
    MerchantRecord | undefined;
}
export function recordRecoveredSettlement(
  db: Database.Database,
  id: string,
  settlement: SettleResponse
) {
  db.prepare("UPDATE merchant_receipts SET status='settled', settle_json=? WHERE id=?").run(
    JSON.stringify(settlement),
    id
  );
}

export function createMerchant(options: {
  db: Database.Database;
  origin: string;
  recipient: string;
  sponsor: string;
  facilitator: FacilitatorClient;
  data: DataTools;
  isReady: () => Promise<boolean>;
}) {
  const { db, origin, recipient, sponsor, facilitator, data } = options;
  initializeMerchantStore(db);
  let inFlight = 0;
  let windowStart = Date.now();
  let admitted = 0;
  const ipWindows = new Map<string, { start: number; count: number }>();
  function admit(req: Request, res: Response): boolean {
    const now = Date.now();
    if (now - windowStart >= 60_000) {
      windowStart = now;
      admitted = 0;
      ipWindows.clear();
    }
    const ip = req.ip ?? 'unknown';
    const bucket = ipWindows.get(ip) ?? { start: now, count: 0 };
    if (inFlight >= 2 || admitted >= 24 || bucket.count >= 8) {
      res
        .status(429)
        .json({
          error: 'Merchant verification capacity reached. Retry the same payment identity later.',
        });
      return false;
    }
    const count = db
      .prepare(
        "SELECT COUNT(*) AS n FROM merchant_receipts WHERE created_at >= datetime('now','-1 day')"
      )
      .get() as { n: number };
    if (count.n >= 1000) {
      res.status(429).json({ error: 'Merchant daily verification limit reached.' });
      return false;
    }
    admitted++;
    bucket.count++;
    ipWindows.set(ip, bucket);
    inFlight++;
    // Keep the permit until the actual async middleware finishes, including after a disconnected client.
    let released = false;
    res.locals.releasePaymentPermit = () => {
      if (!released) {
        released = true;
        inFlight--;
      }
    };
    return true;
  }
  // The durable pre-settle write happens before handing a payload to a broadcaster.
  const durableFacilitator: FacilitatorClient = {
    getSupported: () => facilitator.getSupported(),
    verify: async (payload, requirements) => {
      const result = await facilitator.verify(payload, requirements);
      const id = extractPaymentIdentifier(payload);
      if (id)
        db.prepare('UPDATE merchant_receipts SET status=? WHERE id=? AND status=?').run(
          result.isValid ? 'verified' : 'rejected',
          id,
          'verifying'
        );
      return result;
    },
    settle: async (payload, requirements) => {
      const id = extractPaymentIdentifier(payload);
      if (!id) throw new PaymentError('id', 'Missing payment identifier.');
      const claim = db
        .prepare(
          "UPDATE merchant_receipts SET status='settling' WHERE id=? AND status='verified' AND result_json IS NOT NULL"
        )
        .run(id);
      if (claim.changes !== 1)
        throw new PaymentError(
          'settlement-unknown',
          'Payment already submitted or unavailable; reconcile the original payment.'
        );
      try {
        const settled = await facilitator.settle(payload, requirements);
        db.prepare('UPDATE merchant_receipts SET status=?, settle_json=? WHERE id=?').run(
          settled.success ? 'settled' : 'unknown',
          JSON.stringify(settled),
          id
        );
        return settled;
      } catch {
        db.prepare("UPDATE merchant_receipts SET status='unknown' WHERE id=?").run(id);
        throw new PaymentError(
          'settlement-unknown',
          'Facilitator outcome is unknown; the same payment remains held.'
        );
      }
    },
  };
  const resourceServer = new x402ResourceServer(durableFacilitator)
    .register(PAYMENT_NETWORK, new ExactSvmScheme())
    .registerExtension(paymentIdentifierResourceServerExtension);
  const routes: RoutesConfig = {};
  for (const tool of CATALOG) {
    routes[`POST ${tool.path}`] = {
      accepts: {
        scheme: 'exact',
        network: PAYMENT_NETWORK,
        payTo: recipient,
        maxTimeoutSeconds: 60,
        price: (context) => ({
          amount: tool.price,
          asset: USDC_MINT,
          extra: {
            memo: paymentMemo(
              context.adapter.getHeader('x-payment-id') ?? '',
              canonicalRequest(tool.name, context.adapter.getBody?.(), origin).hash
            ),
          },
        }),
      },
      resource: new URL(tool.path, origin).href,
      description: `Allowance first-party ${tool.title.toLowerCase()}`,
      mimeType: 'application/json',
      extensions: { 'payment-identifier': declarePaymentIdentifierExtension(true) },
    };
  }
  const middleware = paymentMiddleware(routes, resourceServer, undefined, undefined, false);
  let initializing: Promise<void> | undefined;
  const initialize = () =>
    (initializing ??= resourceServer.initialize().catch((error) => {
      initializing = undefined;
      throw error;
    }));
  function mount(app: Express) {
    for (const tool of CATALOG) {
      app.post(
        tool.path,
        async (req: Request, res: Response, next: NextFunction) => {
          try {
            res.setHeader('Cache-Control', 'private, no-store');
            if (req.originalUrl !== tool.path)
              throw new PaymentError(
                'route',
                'Only the exact route without query parameters is allowed.'
              );
            const canonical = canonicalRequest(tool.name, req.body, origin);
            const id = req.header('x-payment-id');
            if (!id || !isValidPaymentId(id)) {
              res
                .status(400)
                .json({ error: 'A stable x-payment-id of 16–128 characters is required.' });
              return;
            }
            const header = req.header('payment-signature');
            if (header) {
              if (header.length > 8192)
                throw new PaymentError('payload', 'Payment header exceeds its bound.');
              const payload = decodePaymentSignatureHeader(header);
              if (
                payload.x402Version !== 2 ||
                extractPaymentIdentifier(payload) !== id ||
                payload.resource?.url !== canonical.url
              )
                throw new PaymentError('binding', 'Payment identifier or resource mismatch.');
              const expected: PaymentRequirements = {
                scheme: 'exact',
                network: PAYMENT_NETWORK,
                asset: USDC_MINT,
                amount: tool.price,
                payTo: recipient,
                maxTimeoutSeconds: 60,
                extra: { feePayer: sponsor, memo: paymentMemo(id, canonical.hash) },
              };
              const accepted = payload.accepted;
              if (
                accepted?.scheme !== expected.scheme ||
                accepted.network !== expected.network ||
                accepted.asset !== expected.asset ||
                accepted.payTo !== recipient ||
                accepted.amount !== tool.price ||
                accepted.extra?.feePayer !== sponsor ||
                accepted.extra?.memo !== expected.extra.memo ||
                accepted.maxTimeoutSeconds !== 60
              )
                throw new PaymentError('terms', 'Payment does not match merchant terms.');
              const payer = verifyPayerSignature(payload);
              await validateTransaction(decodePaymentTransaction(payload).message, {
                payer,
                sponsor,
                recipient,
                amount: tool.price,
                memo: paymentMemo(id, canonical.hash),
              });
              const payloadHash = sha256(JSON.stringify(payload));
              const existing = getMerchantRecord(db, id);
              if (existing) {
                if (
                  existing.canonical_hash !== canonical.hash ||
                  existing.payload_hash !== payloadHash ||
                  existing.payer !== payer
                ) {
                  res
                    .status(409)
                    .json({
                      error: 'Payment identifier conflicts with the original signed request.',
                    });
                  return;
                }
                if (existing.status === 'settled' && existing.settle_json) {
                  res.setHeader(
                    'PAYMENT-RESPONSE',
                    encodePaymentResponseHeader(JSON.parse(existing.settle_json) as SettleResponse)
                  );
                  if (existing.result_json) {
                    res.json(JSON.parse(existing.result_json));
                    return;
                  }
                  res
                    .status(503)
                    .json({
                      error: 'Payment settled, but its result is unavailable.',
                      paymentStatus: 'settled-but-result-unavailable',
                    });
                  return;
                }
                res
                  .status(409)
                  .json({
                    error: 'Original payment is pending or needs reconciliation.',
                    paymentStatus: 'settlement-unknown',
                  });
                return;
              }
              if (!admit(req, res)) return;
              if (!(await options.isReady())) {
                res
                  .status(503)
                  .json({
                    error: 'Devnet payment service is not configured or preflight has failed.',
                  });
                return;
              }
              db.prepare(
                'INSERT INTO merchant_receipts(id,canonical_hash,payload_hash,payer,status,payload_json,requirements_json) VALUES(?,?,?,?,?,?,?)'
              ).run(
                id,
                canonical.hash,
                payloadHash,
                payer,
                'verifying',
                JSON.stringify(payload),
                JSON.stringify(expected)
              );
              res.locals.paymentIdentifier = id;
            }
            if (!header && !(await options.isReady())) {
              res
                .status(503)
                .json({
                  error: 'Devnet payment service is not configured or preflight has failed.',
                });
              return;
            }
            await initialize();
            await middleware(req, res, next);
          } catch (error) {
            res
              .status(error instanceof PaymentError || error instanceof ZodError ? 400 : 503)
              .json({
                error:
                  error instanceof PaymentError
                    ? error.message
                    : error instanceof ZodError
                      ? 'Tool arguments are invalid.'
                      : 'Merchant validation or storage unavailable.',
              });
          } finally {
            const release = res.locals.releasePaymentPermit;
            if (typeof release === 'function') release();
          }
        },
        async (req: Request, res: Response) => {
          const id = res.locals.paymentIdentifier as string | undefined;
          if (!id) {
            res.status(402).json({ error: 'A verified payment is required.' });
            return;
          }
          try {
            const args = JSON.parse(canonicalRequest(tool.name, req.body, origin).body) as {
              address?: string;
              signature?: string;
            };
            const result =
              tool.name === 'wallet_snapshot'
                ? await data.walletSnapshot(args.address!)
                : await data.transactionExplain(args.signature!);
            const encoded = JSON.stringify(result);
            if (Buffer.byteLength(encoded) > 128_000)
              throw new PaymentError('result-size', 'Tool result exceeds its bound.');
            const saved = db
              .prepare(
                "UPDATE merchant_receipts SET result_json=? WHERE id=? AND status='verified'"
              )
              .run(encoded, id);
            if (saved.changes !== 1)
              throw new PaymentError('receipt', 'Verified receipt is unavailable.');
            res.json(result);
          } catch {
            res
              .status(503)
              .json({
                error:
                  'Upstream data is unavailable. This signed request needs reconciliation before another payment.',
              });
          }
        }
      );
    }
  }
  return { mount, initialize, resourceServer };
}

export function merchantToolForPath(path: string): ToolName | undefined {
  return CATALOG.find((tool) => tool.path === path)?.name;
}
