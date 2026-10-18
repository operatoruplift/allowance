import { timingSafeEqual } from 'node:crypto';
import type { Express, NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { TOOL_NAMES, toolArgs } from '../../shared/domain.js';
import { directPaymentRequestSchema, requestIdSchema } from '../../shared/mandate.js';
import type { PaidToolRunner } from '../agent/runner.js';
import type { Config } from '../config.js';
import type { MandateLedger } from '../direct/ledger.js';
import type { DirectPaymentService } from '../direct/service.js';
import { serializeBridgeError, type BridgeErrorBody } from './backend.js';

const idSchema = z.string().uuid();
const purchaseSchema = z
  .object({
    requestId: requestIdSchema,
    tool: z.enum(TOOL_NAMES),
    args: z.record(z.string(), z.string()),
  })
  .strict();

function presentedToken(req: Request): string {
  const header = req.get('authorization') ?? '';
  return header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
}

/**
 * Token authentication for the bridge endpoint: no session, cookie or CSRF
 * token, because the caller is the local MCP bridge process, never a browser.
 * The token is a shared secret both processes read from the private
 * environment, and a request that came through the reverse proxy is refused.
 */
export function requireBridgeToken(config: Config) {
  return (req: Request, res: Response, next: NextFunction) => {
    const refuse = (status: number, code: string, error: string) => {
      res.status(status).json({ kind: 'unavailable', code, error } satisfies BridgeErrorBody);
    };
    if (!config.mcpEnabled) return refuse(503, 'MCP_DISABLED', 'External-agent access is disabled.');
    if (!config.mcpBackendToken)
      return refuse(
        503,
        'BRIDGE_DISABLED',
        'Set MCP_BACKEND_TOKEN for the backend and the bridge; the bridge endpoint is off until then.'
      );
    if (config.proxyHops > 0 && req.get('x-forwarded-for'))
      return refuse(403, 'BRIDGE_NOT_LOCAL', 'The bridge endpoint accepts only direct local connections.');
    const presented = Buffer.from(presentedToken(req), 'utf8');
    const expected = Buffer.from(config.mcpBackendToken, 'utf8');
    if (presented.length !== expected.length || !timingSafeEqual(presented, expected))
      return refuse(401, 'BRIDGE_UNAUTHORIZED', 'A valid bridge token is required.');
    next();
  };
}

/**
 * The two paid operations the MCP bridge forwards instead of signing itself.
 * Both reuse the same services the operator API uses; the ledger still checks
 * the human grant inside each reservation and signing claim.
 */
export function mountBridgeRoutes(
  app: Express,
  deps: {
    config: Config;
    direct: DirectPaymentService;
    mandates: MandateLedger;
    payments: PaidToolRunner;
  }
): void {
  const guard = requireBridgeToken(deps.config);
  const fail = (res: Response, error: unknown) => {
    const { status, body } = serializeBridgeError(error);
    res.status(status).json(body);
  };
  app.post('/api/bridge/mandates/:id/payments', guard, async (req, res) => {
    try {
      const id = idSchema.parse(req.params.id);
      const request = directPaymentRequestSchema.parse(req.body);
      deps.mandates.get(id);
      res.json({ payment: await deps.direct.pay(id, request, 'external-agent') });
    } catch (error) {
      fail(res, error);
    }
  });
  app.post('/api/bridge/runs/:id/purchases', guard, async (req, res) => {
    try {
      const id = idSchema.parse(req.params.id);
      const input = purchaseSchema.parse(req.body);
      const args = toolArgs[input.tool].parse(input.args);
      res.json({ data: await deps.payments.runPaidTool(id, input.requestId, input.tool, args) });
    } catch (error) {
      fail(res, error);
    }
  });
}
