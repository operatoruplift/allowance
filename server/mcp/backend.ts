import { z } from 'zod';
import type { ToolName } from '../../shared/domain.js';
import type { DirectPaymentDTO, DirectPaymentRequest } from '../../shared/mandate.js';
import type { PaidToolRunner } from '../agent/runner.js';
import type { Config } from '../config.js';
import type { DirectPaymentService } from '../direct/service.js';
import { PaymentError } from '../payments/guard.js';
import { boundedJson } from '../payments/rpc.js';
import { PolicyError } from '../policy/decision.js';
import { AgentGrantError } from './grants.js';

/**
 * Where the bridge's paid tools execute. The bridge process holds no payer key:
 * by default every payment is forwarded to the running backend over its
 * token-authenticated loopback endpoint, and only the backend signs.
 */
export interface PaymentBackend {
  /** One line for stderr at bridge start: where the key is, and where payments run. */
  readonly description: string;
  payDirect(mandateId: string, request: DirectPaymentRequest): Promise<DirectPaymentDTO>;
  runPaidTool(
    runId: string,
    requestId: string,
    tool: ToolName,
    args: Record<string, string>
  ): Promise<unknown>;
}

export const LOCAL_SIGNER_FLAG = 'ALLOWANCE_MCP_LOCAL_SIGNER';
export const BRIDGE_TIMEOUT_MS = 90_000;

/** The configuration a bridge process may run with: no payer key source unless the operator opted in. */
export function bridgeRuntimeConfig(
  config: Config,
  env: NodeJS.ProcessEnv = process.env
): { config: Config; localSigner: boolean } {
  const localSigner = env[LOCAL_SIGNER_FLAG] === '1';
  if (localSigner) return { config, localSigner };
  return { config: { ...config, payerSecretFile: '', payerSecretJson: '' }, localSigner };
}

/** Executes payments in this process; meaningful only when a signer was deliberately loaded here. */
export function inProcessBackend(runtime: {
  direct: DirectPaymentService;
  payments: PaidToolRunner;
}): PaymentBackend {
  return {
    description: `${LOCAL_SIGNER_FLAG}=1: the payer key is loaded inside this MCP client process tree. Prefer the backend bridge endpoint.`,
    payDirect: (mandateId, request) => runtime.direct.pay(mandateId, request, 'external-agent'),
    runPaidTool: (runId, requestId, tool, args) =>
      runtime.payments.runPaidTool(runId, requestId, tool, args),
  };
}

/** The error envelope the backend's bridge endpoint returns; the client rebuilds the original error class. */
export const bridgeErrorSchema = z
  .object({
    kind: z.enum(['payment', 'policy', 'grant', 'invalid', 'unavailable']),
    code: z.string().max(64),
    error: z.string().max(1000),
    intentId: z.string().max(128).optional(),
  })
  .strict();
export type BridgeErrorBody = z.infer<typeof bridgeErrorSchema>;

export function serializeBridgeError(error: unknown): { status: number; body: BridgeErrorBody } {
  if (error instanceof PaymentError)
    return {
      status: error.code === 'disabled' || error.code === 'unavailable' ? 503 : 409,
      body: {
        kind: 'payment',
        code: error.code,
        error: error.message,
        ...(error.intentId ? { intentId: error.intentId } : {}),
      },
    };
  if (error instanceof PolicyError)
    return { status: 409, body: { kind: 'policy', code: 'POLICY_DENIED', error: error.message } };
  if (error instanceof AgentGrantError)
    return { status: 403, body: { kind: 'grant', code: error.code, error: error.message } };
  if (error instanceof z.ZodError)
    return {
      status: 400,
      body: { kind: 'invalid', code: 'INVALID_FIELDS', error: 'Invalid request fields.' },
    };
  if (error instanceof Error && /not found\.$/.test(error.message))
    return { status: 404, body: { kind: 'invalid', code: 'NOT_FOUND', error: error.message } };
  return {
    status: 503,
    body: {
      kind: 'unavailable',
      code: 'SERVICE_UNAVAILABLE',
      error:
        'The backend could not complete this request. No new spending is authorized by this error.',
    },
  };
}

const GRANT_CODES = ['GRANT_INVALID', 'GRANT_EXPIRED', 'GRANT_REVOKED', 'GRANT_SCOPE_DENIED'] as const;

export function deserializeBridgeError(body: BridgeErrorBody): Error {
  switch (body.kind) {
    case 'payment':
      return new PaymentError(body.code, body.error, body.intentId);
    case 'policy':
      return new PolicyError(body.error);
    case 'grant': {
      const code = GRANT_CODES.find((candidate) => candidate === body.code) ?? 'GRANT_INVALID';
      return new AgentGrantError(code, body.error);
    }
    case 'invalid':
      return new PaymentError('backend-rejected', body.error);
    default:
      return new PaymentError('backend-unavailable', body.error);
  }
}

const paymentEnvelope = z.object({ payment: z.looseObject({ id: z.string(), status: z.string() }) });
const dataEnvelope = z.object({ data: z.unknown() });

/**
 * Forwards paid tools to the backend over HTTP on the loopback interface. The
 * bridge authenticates with the shared MCP_BACKEND_TOKEN; without one, every
 * paid call answers that payments are unavailable here and nothing is signed.
 */
export function httpBackend(options: {
  url: string;
  token: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): PaymentBackend {
  const fetcher = options.fetch ?? fetch;
  const base = new URL(options.url);
  async function post<T>(path: string, body: unknown, parse: (value: unknown) => T): Promise<T> {
    if (!options.token)
      throw new PaymentError(
        'backend-unavailable',
        'MCP_BACKEND_TOKEN is not configured; this bridge holds no payer key and cannot execute payments.'
      );
    let response: Response;
    try {
      response = await fetcher(new URL(path, base), {
        method: 'POST',
        headers: { authorization: `Bearer ${options.token}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        redirect: 'error',
        signal: AbortSignal.timeout(options.timeoutMs ?? BRIDGE_TIMEOUT_MS),
      });
    } catch {
      throw new PaymentError(
        'backend-unavailable',
        `The Allowance backend at ${base.origin} did not answer; keep it running next to the bridge.`
      );
    }
    const payload = await boundedJson(response).catch(() => undefined);
    if (!response.ok) {
      const envelope = bridgeErrorSchema.safeParse(payload);
      throw envelope.success
        ? deserializeBridgeError(envelope.data)
        : new PaymentError(
            'backend-unavailable',
            `The Allowance backend answered HTTP ${response.status} without a readable reason.`
          );
    }
    return parse(payload);
  }
  return {
    description: options.token
      ? `no payer key is loaded in this process; payments execute on the backend at ${base.origin} through its token-authenticated bridge endpoint.`
      : 'no payer key is loaded in this process and MCP_BACKEND_TOKEN is unset, so execute_guarded_payment, wallet_snapshot and transaction_explain answer PAYMENT_UNAVAILABLE; read and stop tools still work.',
    payDirect: (mandateId, request) =>
      post(
        `/api/bridge/mandates/${mandateId}/payments`,
        request,
        (value) => paymentEnvelope.parse(value).payment as unknown as DirectPaymentDTO
      ),
    runPaidTool: (runId, requestId, tool, args) =>
      post(
        `/api/bridge/runs/${runId}/purchases`,
        { requestId, tool, args },
        (value) => dataEnvelope.parse(value).data
      ),
  };
}
