import express from 'express';
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
export function createApp(
  config: Config,
  db: Database.Database,
  ledger: Ledger,
  payments: RuntimePayments,
  runner: AgentRunner | null,
  dataProbe: () => Promise<unknown>
) {
  const app = express();
  app.disable('x-powered-by');
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
  const { requireOperator } = installAuth(app, db, config);
  let observed: Awaited<ReturnType<RuntimePayments['readiness']>> | undefined;
  let dataReady = false;
  let preflightAt = 0;
  function configDto(): AppConfigDTO {
    const readiness = [
      ...configurationReadiness(config),
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
    const result = await Promise.allSettled([payments.readiness(), dataProbe()]);
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
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found.' }));
  app.use(
    (error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      if (error instanceof z.ZodError) {
        res
          .status(400)
          .json({ error: 'Invalid request fields.', fields: z.flattenError(error).fieldErrors });
        return;
      }
      if (error instanceof PolicyError) {
        res.status(409).json({ error: error.message });
        return;
      }
      if (error instanceof Error && error.message === 'Run not found.') {
        res.status(404).json({ error: 'Run not found.' });
        return;
      }
      res.status(503).json({
        error:
          'The service could not complete this request. No new spending is authorized by this error.',
      });
    }
  );
  return app;
}
