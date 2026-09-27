import express from 'express';
import { randomUUID } from 'node:crypto';
import helmet from 'helmet';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import {
  CATALOG,
  DEFAULT_TASK,
  createRunSchema,
  type AppConfigDTO,
  type ReadinessItem,
} from '../shared/domain.js';
import { installAuth } from './auth/index.js';
import { configurationReadiness, type Config } from './config.js';
import { Ledger } from './policy/ledger.js';
import { PolicyError } from './policy/decision.js';
import { AgentRunner, type PaidToolRunner } from './agent/runner.js';
import { createAgentGrant } from './mcp/grants.js';
import { MandateLedger } from './direct/ledger.js';
import { createMandateGrant, revokeMandateGrant } from './direct/grants.js';
import { ApprovalError, verifyRecipientApproval } from './direct/approval.js';
import type { DirectPaymentService } from './direct/service.js';
import { PaymentError } from './payments/guard.js';
import {
  createMandateSchema,
  directPaymentRequestSchema,
  recipientApprovalSchema,
} from '../shared/mandate.js';
import { restoreReadiness } from './db/recovery.js';
export interface RuntimePayments extends PaidToolRunner {
  mountMerchant(app: express.Express): void;
  readiness(): Promise<{
    ready: boolean;
    items: ReadinessItem[];
    payer: string | null;
    balance: { usdc: string | null; sol: string | null };
  }>;
  reconcile(): Promise<void>;
}
/** A service that refuses every direct payment; used when the runtime did not construct one. */
export function disabledDirectPayments(network: Config['paymentNetwork']): DirectPaymentService {
  return {
    enabled: false,
    payer: null,
    async readiness() {
      return {
        ready: false,
        network,
        payer: null,
        balance: { usdc: null, sol: null },
        items: [
          {
            name: 'Direct payments opt-in',
            ready: false,
            detail: 'DIRECT_PAYMENTS_ENABLED is false; mandates cannot move USDC.',
          },
        ],
      };
    },
    async pay() {
      throw new PaymentError('disabled', 'Direct payments are not enabled; no transfer was signed.');
    },
    async reconcile() {},
  };
}
export function createApp(
  config: Config,
  db: Database.Database,
  ledger: Ledger,
  payments: RuntimePayments,
  runner: AgentRunner | null,
  dataProbe: () => Promise<unknown>,
  extras: { mandates?: MandateLedger; direct?: DirectPaymentService } = {}
) {
  const mandates = extras.mandates ?? new MandateLedger(db, config, ledger);
  const direct = extras.direct ?? disabledDirectPayments(config.paymentNetwork);
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    // Never accept a caller-supplied identifier as trusted diagnostic context.
    res.setHeader('X-Request-ID', randomUUID());
    if (req.path === '/api' || req.path.startsWith('/api/'))
      res.setHeader('Cache-Control', 'no-store');
    next();
  });
  if (config.proxyHops) app.set('trust proxy', config.proxyHops);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: config.production ? ["'self'"] : ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          fontSrc: ["'self'"],
          imgSrc: ["'self'", 'data:'],
          mediaSrc: ["'self'"],
          connectSrc: config.production
            ? ["'self'"]
            : ["'self'", 'ws://localhost:*', 'ws://127.0.0.1:*'],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: new URL(config.origin).protocol === 'https:' ? [] : null,
        },
      },
      strictTransportSecurity: new URL(config.origin).protocol === 'https:' ? undefined : false,
    })
  );
  app.use(express.json({ limit: '24kb', strict: true }));
  payments.mountMerchant(app);
  const { requireOperator } = installAuth(app, db, config, () => runner?.stopActive());
  let observed: Awaited<ReturnType<RuntimePayments['readiness']>> | undefined;
  let directObserved: Awaited<ReturnType<DirectPaymentService['readiness']>> | undefined;
  let dataReady = false;
  let preflightAt = 0;
  function directDto() {
    return {
      enabled: direct.enabled,
      ready: Boolean(directObserved?.ready) && Date.now() - preflightAt < 60000,
      network: config.paymentNetwork,
      payer: directObserved?.payer ?? direct.payer,
      adminPublicKey: config.adminPublicKey || null,
      items: directObserved?.items ?? [
        {
          name: 'Direct payment preflight',
          ready: false,
          detail: 'Run Check readiness to verify the payer, its USDC account and the payment RPC.',
        },
      ],
      balance: directObserved?.balance ?? { usdc: null, sol: null },
      dailyRemaining: String(Math.max(0, config.dailyCeiling - ledger.dailyUsed())),
    };
  }
  function configDto(): AppConfigDTO {
    const readiness = [
      ...configurationReadiness(config),
      restoreReadiness(db),
      ...(observed?.items || [
        {
          name: 'Live preflight',
          ready: false,
          detail:
            'Run Check readiness to verify RPC, mint, signer, associated token accounts and facilitator.',
        },
      ]),
      {
        name: 'Data RPC',
        ready: dataReady,
        detail: dataReady
          ? `Verified ${config.dataNetwork} data source.`
          : 'Data source has not passed a live RPC check.',
      },
    ];
    if (ledger.payerFrozen())
      readiness.push({
        name: 'Payment recovery',
        ready: false,
        detail:
          'An uncertain payment holds this payer. Reconcile existing purchases before a new run.',
      });
    const externalReady =
      config.mcpEnabled &&
      Date.now() - preflightAt < 60000 &&
      readiness.filter((item) => item.name !== 'OpenAI agent').every((item) => item.ready);
    return {
      tools: CATALOG,
      paymentNetwork: config.paymentNetwork,
      dataNetwork: config.dataNetwork,
      ready: readiness.every((x) => x.ready) && Date.now() - preflightAt < 60000,
      externalReady,
      mcpEnabled: config.mcpEnabled,
      readiness,
      payer: observed?.payer || null,
      recipient: config.recipient || null,
      balance: observed?.balance || { usdc: null, sol: null },
      dailyCeiling: String(config.dailyCeiling),
      dailyRemaining: String(Math.max(0, config.dailyCeiling - ledger.dailyUsed())),
      defaultWallet: config.defaultWallet,
      defaultTask: DEFAULT_TASK,
      llm: {
        model: config.openaiModel || null,
        maxCalls: config.maxLlmCalls,
        maxOutputTokens: config.maxLlmOutputTokens,
        note: 'OpenAI costs are separate from the USDC allowance. Token and call caps apply.',
      },
      direct: directDto(),
    };
  }
  app.get('/api/health', (_req, res) => {
    try {
      db.prepare('SELECT 1').get();
      res.json({ ok: true, service: 'Allowance', paymentNetwork: config.paymentNetwork });
    } catch {
      res.status(503).json({ ok: false });
    }
  });
  app.get('/api/config', requireOperator, (_req, res) => res.json(configDto()));
  app.post('/api/preflight', requireOperator, async (_req, res) => {
    const result = await Promise.allSettled([payments.readiness(), dataProbe(), direct.readiness()]);
    directObserved =
      result[2].status === 'fulfilled'
        ? result[2].value
        : {
            ready: false,
            network: config.paymentNetwork,
            payer: direct.payer,
            balance: { usdc: null, sol: null },
            items: [
              {
                name: 'Direct payment preflight',
                ready: false,
                detail: 'Direct payment preflight failed. Inspect configuration and try again.',
              },
            ],
          };
    observed =
      result[0].status === 'fulfilled'
        ? result[0].value
        : {
            ready: false,
            items: [
              {
                name: 'Payment preflight',
                ready: false,
                detail: 'Preflight failed. Inspect configuration and try again.',
              },
            ],
            payer: null,
            balance: { usdc: null, sol: null },
          };
    dataReady = result[1].status === 'fulfilled';
    preflightAt = Date.now();
    res.json(configDto());
  });
  app.get('/api/runs', requireOperator, (_req, res) => res.json({ runs: ledger.listRuns() }));
  app.post('/api/runs', requireOperator, (req, res) => {
    if (!runner || !configDto().ready) {
      res.status(503).json({
        error:
          'Live execution is unavailable. Complete configuration and run a fresh readiness check.',
      });
      return;
    }
    if (runner.isBusy()) {
      res.status(409).json({ error: 'A run is already active.' });
      return;
    }
    const input = createRunSchema.parse(req.body);
    const run = ledger.createRun(input);
    runner.start(run.id);
    res.status(201).json(ledger.getRun(run.id));
  });
  app.post('/api/external-runs', requireOperator, (req, res) => {
    if (!config.mcpEnabled) {
      res.status(503).json({ error: 'External-agent access is disabled.', code: 'MCP_DISABLED' });
      return;
    }
    const current = configDto();
    const externalReady =
      Date.now() - preflightAt < 60000 &&
      current.readiness.filter((item) => item.name !== 'OpenAI agent').every((item) => item.ready);
    if (!externalReady) {
      res.status(503).json({
        error:
          'External-agent execution is unavailable. Complete configuration and run a fresh readiness check.',
        code: 'EXTERNAL_NOT_READY',
      });
      return;
    }
    const input = createRunSchema.parse(req.body);
    const run = ledger.createRun(input, 'operator', 'external');
    ledger.setStatus(run.id, 'running');
    try {
      const result = createAgentGrant(db, ledger, {
        runId: run.id,
        owner: 'operator',
        sessionId: req.sessionID,
        expiresAt: run.policy.expiresAt,
      });
      res.status(201).json({
        run: ledger.getRun(run.id),
        grant: {
          id: result.grant.id,
          expiresAt: result.grant.expiresAt,
          scopes: result.grant.scopes,
          token: result.token,
        },
      });
    } catch (error) {
      ledger.stop(run.id);
      throw error;
    }
  });
  const runIdSchema = z.string().uuid();
  app.get('/api/runs/:id', requireOperator, (req, res) =>
    res.json(ledger.getRun(runIdSchema.parse(req.params.id)))
  );
  app.post('/api/runs/:id/stop', requireOperator, (req, res) => {
    const id = runIdSchema.parse(req.params.id);
    if (runner) runner.stop(id);
    else ledger.stop(id);
    res.json(ledger.getRun(id));
  });
  app.post('/api/runs/:id/probe', requireOperator, (req, res) =>
    res.json(ledger.probe(runIdSchema.parse(req.params.id)))
  );
  app.post('/api/runs/:id/reconcile', requireOperator, async (req, res) => {
    const id = runIdSchema.parse(req.params.id);
    ledger.getRun(id);
    await payments.reconcile();
    res.json(ledger.getRun(id));
  });
  app.get('/api/runs/:id/export', requireOperator, (req, res) => {
    const id = runIdSchema.parse(req.params.id);
    const dto = ledger.getRun(id);
    res.setHeader('Content-Disposition', `attachment; filename="allowance-${id}.json"`);
    res.json(dto);
  });
  // Mandates: frozen recipient allowlists with caps, paid by direct USDC transfers.
  const mandateIdSchema = z.string().uuid();
  function directError(error: unknown, res: express.Response): boolean {
    if (error instanceof PaymentError) {
      const status = error.code === 'disabled' ? 503 : error.code.startsWith('insufficient') ? 409 : 503;
      res.status(status).json({
        error: error.message,
        code: `DIRECT_${error.code.toUpperCase().replace(/-/g, '_')}`,
        requestId: res.getHeader('X-Request-ID'),
        ...(error.intentId ? { payment: mandates.getPayment(error.intentId) } : {}),
      });
      return true;
    }
    if (error instanceof ApprovalError) {
      res.status(403).json({
        error: error.message,
        code: `APPROVAL_${error.code.toUpperCase().replace(/-/g, '_')}`,
        requestId: res.getHeader('X-Request-ID'),
      });
      return true;
    }
    if (error instanceof Error && error.message === 'Mandate not found.') {
      res.status(404).json({ error: 'Mandate not found.' });
      return true;
    }
    return false;
  }
  app.get('/api/mandates', requireOperator, (_req, res) => res.json({ mandates: mandates.list() }));
  app.post('/api/mandates', requireOperator, (req, res) => {
    if (!direct.enabled || !direct.payer) {
      res.status(503).json({ error: 'Direct payments are disabled.', code: 'DIRECT_DISABLED' });
      return;
    }
    if (!directDto().ready) {
      res.status(503).json({
        error: 'Direct payments are unavailable. Complete configuration and run a fresh readiness check.',
        code: 'DIRECT_NOT_READY',
      });
      return;
    }
    const input = createMandateSchema.parse(req.body);
    const mandate = mandates.create(input, direct.payer);
    try {
      const grant = createMandateGrant(db, mandates, {
        mandateId: mandate.id,
        owner: 'operator',
        sessionId: req.sessionID,
        expiresAt: mandate.policy.expiresAt,
      });
      res.status(201).json({
        mandate: mandates.get(mandate.id),
        grant: { id: grant.grant.id, expiresAt: grant.grant.expiresAt, scopes: grant.grant.scopes, token: grant.token },
      });
    } catch (error) {
      mandates.stop(mandate.id);
      throw error;
    }
  });
  app.get('/api/mandates/:id', requireOperator, (req, res, next) => {
    try {
      res.json(mandates.get(mandateIdSchema.parse(req.params.id)));
    } catch (error) {
      if (!directError(error, res)) next(error);
    }
  });
  app.post('/api/mandates/:id/stop', requireOperator, (req, res, next) => {
    try {
      const id = mandateIdSchema.parse(req.params.id);
      const mandate = mandates.stop(id);
      revokeMandateGrant(db, id, 'operator');
      res.json(mandate);
    } catch (error) {
      if (!directError(error, res)) next(error);
    }
  });
  app.post('/api/mandates/:id/recipients', requireOperator, async (req, res, next) => {
    try {
      const id = mandateIdSchema.parse(req.params.id);
      const approval = recipientApprovalSchema.parse(req.body);
      mandates.get(id);
      await verifyRecipientApproval(id, approval, config.adminPublicKey);
      res.status(201).json(mandates.addRecipient(id, approval));
    } catch (error) {
      if (!directError(error, res)) next(error);
    }
  });
  app.post('/api/mandates/:id/payments', requireOperator, async (req, res, next) => {
    try {
      const id = mandateIdSchema.parse(req.params.id);
      const request = directPaymentRequestSchema.parse(req.body);
      mandates.get(id);
      const payment = await direct.pay(id, request, 'operator');
      res.status(payment.status === 'denied' ? 409 : 201).json({ payment, mandate: mandates.get(id) });
    } catch (error) {
      if (!directError(error, res)) next(error);
    }
  });
  app.post('/api/mandates/:id/reconcile', requireOperator, async (req, res, next) => {
    try {
      const id = mandateIdSchema.parse(req.params.id);
      mandates.get(id);
      await direct.reconcile();
      res.json(mandates.get(id));
    } catch (error) {
      if (!directError(error, res)) next(error);
    }
  });
  app.get('/api/mandates/:id/export', requireOperator, (req, res, next) => {
    try {
      const id = mandateIdSchema.parse(req.params.id);
      const dto = mandates.get(id);
      res.setHeader('Content-Disposition', `attachment; filename="allowance-mandate-${id}.json"`);
      res.json(dto);
    } catch (error) {
      if (!directError(error, res)) next(error);
    }
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found.' }));
  app.use(
    (error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      if (error instanceof z.ZodError) {
        res
          .status(400)
          .json({
            error: 'Invalid request fields.',
            code: 'INVALID_FIELDS',
            requestId: res.getHeader('X-Request-ID'),
            fields: z.flattenError(error).fieldErrors,
          });
        return;
      }
      if (error instanceof PolicyError) {
        res
          .status(409)
          .json({
            error: error.message,
            code: 'POLICY_DENIED',
            requestId: res.getHeader('X-Request-ID'),
          });
        return;
      }
      if (error instanceof Error && error.message === 'Run not found.') {
        res.status(404).json({ error: 'Run not found.' });
        return;
      }
      const bodyError = error as { type?: unknown } | null;
      if (bodyError?.type === 'entity.too.large' || bodyError?.type === 'entity.parse.failed') {
        res.status(bodyError.type === 'entity.too.large' ? 413 : 400).json({
          error: 'Request body must be valid JSON within the allowed size.',
          code: 'INVALID_BODY',
          requestId: res.getHeader('X-Request-ID'),
        });
        return;
      }
      res.status(503).json({
        code: 'SERVICE_UNAVAILABLE',
        requestId: res.getHeader('X-Request-ID'),
        error:
          'The service could not complete this request. No new spending is authorized by this error.',
      });
    }
  );
  return app;
}
