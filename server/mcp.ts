import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import { signatureSchema, type RunDTO, type ToolName } from '../shared/domain.js';
import { loadConfig } from './config.js';
import { createRuntime } from './runtime.js';
import { PolicyError } from './policy/decision.js';
import {
  AgentGrantError,
  authorizeAgentGrant,
  revokeAgentGrant,
  type AgentGrantScope,
} from './mcp/grants.js';
import { PaymentError, canonicalRequest } from './payments/service.js';
import { snapshotIncludesSignature } from '../shared/tool-results.js';

const runIdSchema = z.string().uuid();
const requestIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{16,128}$/, 'Use a stable request ID with 16–128 safe characters.');

const walletSnapshotInput = z.object({ runId: runIdSchema, requestId: requestIdSchema }).strict();
const transactionExplainInput = z
  .object({ runId: runIdSchema, requestId: requestIdSchema, signature: signatureSchema })
  .strict();
const runInput = z.object({ runId: runIdSchema }).strict();

type AllowanceRuntime = Awaited<ReturnType<typeof createRuntime>>;

class McpToolError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message);
  }
}

function result(value: unknown) {
  return {
    structuredContent: value as Record<string, unknown>,
    content: [{ type: 'text' as const, text: JSON.stringify(value) }],
  };
}

function errorResult(error: unknown) {
  const code = error instanceof McpToolError ? error.code : 'INTERNAL_ERROR';
  const message =
    error instanceof McpToolError ? error.message : 'The tool could not complete safely.';
  const value = { code, message };
  return {
    isError: true as const,
    structuredContent: value,
    content: [{ type: 'text' as const, text: `${code}: ${message}` }],
  };
}

function paymentError(error: PaymentError): McpToolError {
  const codes: Record<string, string> = {
    unavailable: 'PAYMENT_UNAVAILABLE',
    disabled: 'PAYMENT_UNAVAILABLE',
    'settlement-unknown': 'SETTLEMENT_UNKNOWN',
    challenge: 'PAYMENT_CHALLENGE_INVALID',
    'invalid-challenge': 'PAYMENT_CHALLENGE_INVALID',
    'delivery-failed': 'DELIVERY_FAILED',
    'result-unavailable': 'DELIVERY_FAILED',
    'recovery-limit': 'SETTLEMENT_UNKNOWN',
    duplicate: 'DUPLICATE_REQUEST',
    conflict: 'REQUEST_CONFLICT',
    'request-id': 'INVALID_REQUEST',
    'invalid-tool': 'POLICY_DENIED',
    'policy-mismatch': 'POLICY_DENIED',
  };
  const code = codes[error.code] || 'PAYMENT_FAILED';
  const messages: Record<string, string> = {
    PAYMENT_UNAVAILABLE: 'Live payment readiness is incomplete; no payment was authorized.',
    SETTLEMENT_UNKNOWN: 'Settlement evidence is unresolved; the payer remains held.',
    DELIVERY_FAILED: 'Payment settlement exists but the paid result was not delivered.',
    DUPLICATE_REQUEST: 'This request already has a durable payment identity.',
    REQUEST_CONFLICT: 'The request ID is already bound to a different payment request.',
    INVALID_REQUEST: 'The request ID is invalid.',
    POLICY_DENIED: 'The frozen run policy denied this tool call.',
    PAYMENT_CHALLENGE_INVALID: 'The merchant payment challenge did not match the approved catalog.',
    PAYMENT_FAILED: 'The payment could not complete; inspect the durable receipt.',
  };
  return new McpToolError(code, messages[code] || messages.PAYMENT_FAILED);
}

function grantError(error: unknown): McpToolError {
  if (error instanceof McpToolError) return error;
  if (error instanceof AgentGrantError) return new McpToolError(error.code, error.message);
  const message = error instanceof Error ? error.message : '';
  if (message.includes('expired'))
    return new McpToolError('GRANT_EXPIRED', 'The agent grant has expired.');
  if (message.includes('revoked'))
    return new McpToolError('GRANT_REVOKED', 'The agent grant has been revoked.');
  if (message.includes('does not allow'))
    return new McpToolError('GRANT_SCOPE_DENIED', 'The agent grant does not allow this tool.');
  return new McpToolError('GRANT_INVALID', 'The agent grant is invalid.');
}

function safePurchase(purchase: RunDTO['purchases'][number]) {
  return {
    id: purchase.id,
    requestId: purchase.requestId,
    requestHash: purchase.requestHash,
    policyHash: purchase.policyHash,
    catalogVersion: purchase.catalogVersion,
    catalogHash: purchase.catalogHash,
    messageHash: purchase.messageHash,
    proofSlot: purchase.proofSlot,
    paymentNetwork: purchase.paymentNetwork,
    dataNetwork: purchase.dataNetwork,
    mint: purchase.mint,
    tool: purchase.tool,
    amount: purchase.amount,
    status: purchase.status,
    createdAt: purchase.createdAt,
    signature: purchase.signature,
    chainVerified: purchase.chainVerified,
    serviceOutcome: purchase.serviceOutcome,
    source: purchase.source,
    reason: purchase.reason,
    payer: purchase.payer,
    recipient: purchase.recipient,
    feeSponsor: purchase.feeSponsor,
    feeLamports: purchase.feeLamports,
    originalBlockhash: purchase.originalBlockhash,
    originatingLastValidBlockHeight: purchase.originatingLastValidBlockHeight,
    proofObservedAt: purchase.proofObservedAt,
    deliveryState: purchase.deliveryState,
    resultHash: purchase.resultHash,
  };
}

export function createAllowanceMcpServer(runtime: AllowanceRuntime, grantToken: string) {
  const server = new McpServer({ name: 'allowance', version: '0.1.0' });

  function authorize(runId: string, scope: AgentGrantScope) {
    try {
      authorizeAgentGrant(runtime.db, grantToken, runId, scope);
      const run = runtime.ledger.getRun(runId, 'operator');
      if (run.executionMode !== 'external')
        throw new McpToolError(
          'POLICY_DENIED',
          'This grant is not bound to an external-agent run.'
        );
      return run;
    } catch (error) {
      if (error instanceof McpToolError) throw error;
      throw grantError(error);
    }
  }

  async function paid(
    runId: string,
    requestId: string,
    tool: ToolName,
    args: Record<string, string>
  ) {
    try {
      const data = await runtime.payments.runPaidTool(runId, requestId, tool, args);
      const purchase = runtime.ledger.findIntentByHash(
        runId,
        canonicalRequest(tool, args, runtime.config.origin).hash
      );
      if (!purchase)
        throw new McpToolError(
          'RECEIPT_MISSING',
          'The paid result has no durable receipt identity.'
        );
      const run = runtime.ledger.getRun(runId, 'operator');
      const receipt = run.purchases.find((item) => item.id === purchase.id);
      return {
        runId,
        requestId,
        purchaseId: purchase.id,
        data,
        receipt: receipt ? safePurchase(receipt) : undefined,
      };
    } catch (error) {
      if (error instanceof PaymentError) throw paymentError(error);
      if (error instanceof AgentGrantError) throw grantError(error);
      if (error instanceof McpToolError) throw error;
      if (error instanceof PolicyError)
        throw new McpToolError('POLICY_DENIED', 'The frozen run policy denied this tool call.');
      throw new McpToolError(
        'PAYMENT_FAILED',
        'The payment could not complete; inspect the durable receipt.'
      );
    }
  }

  server.registerTool(
    'wallet_snapshot',
    {
      title: 'Wallet snapshot',
      description: 'Buy the fixed wallet snapshot tool for the authorized run wallet.',
      inputSchema: walletSnapshotInput,
    },
    async ({ runId, requestId }) => {
      try {
        const run = authorize(runId, 'wallet_snapshot');
        return result(await paid(runId, requestId, 'wallet_snapshot', { address: run.wallet }));
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    'transaction_explain',
    {
      title: 'Transaction explanation',
      description:
        'Buy a bounded explanation for a signature already returned by this run wallet snapshot.',
      inputSchema: transactionExplainInput,
    },
    async ({ runId, requestId, signature }) => {
      try {
        const run = authorize(runId, 'transaction_explain');
        if (!snapshotIncludesSignature(run, signature))
          throw new McpToolError(
            'POLICY_DENIED',
            'The signature was not returned by this run wallet snapshot.'
          );
        return result(await paid(runId, requestId, 'transaction_explain', { signature }));
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    'get_run_status',
    {
      title: 'Run status',
      description: 'Read the status and bounded spending totals for an authorized external run.',
      inputSchema: runInput,
    },
    async ({ runId }) => {
      try {
        const run = authorize(runId, 'get_run_status');
        return result({
          runId: run.id,
          status: run.status,
          executionMode: run.executionMode,
          authorized: run.authorized,
          settled: run.settled,
          held: run.held,
          remaining: run.remaining,
          purchases: run.purchases.map(safePurchase),
        });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    'get_receipt',
    {
      title: 'Run receipt',
      description: 'Read the durable receipt for an authorized external run.',
      inputSchema: runInput,
    },
    async ({ runId }) => {
      try {
        const run = authorize(runId, 'get_receipt');
        return result({
          runId: run.id,
          executionMode: run.executionMode,
          policy: run.policy,
          status: run.status,
          authorized: run.authorized,
          settled: run.settled,
          held: run.held,
          remaining: run.remaining,
          purchases: run.purchases.map((purchase) => ({
            ...safePurchase(purchase),
            result: purchase.result,
          })),
          events: run.events,
          error: run.error,
        });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    'stop_run',
    {
      title: 'Stop run',
      description: 'Stop the authorized external run and revoke its agent grant.',
      inputSchema: runInput,
    },
    async ({ runId }) => {
      try {
        authorize(runId, 'stop_run');
        const run = runtime.ledger.stop(runId, 'operator');
        revokeAgentGrant(runtime.db, runId, 'operator');
        return result({ runId, status: run.status, grantRevoked: true });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  return server;
}

export async function main() {
  const config = loadConfig();
  if (!config.mcpEnabled)
    throw new Error('MCP is disabled. Set MCP_ENABLED=true to enable the local stdio bridge.');
  const grantToken = process.env.MCP_GRANT_TOKEN || '';
  if (!grantToken)
    throw new Error(
      'MCP_GRANT_TOKEN is required; create an external run through the operator API first.'
    );
  const runtime = await createRuntime(config, { recover: false, exclusive: false, shared: true });
  const server = createAllowanceMcpServer(runtime, grantToken);
  const transport = new StdioServerTransport();
  transport.onerror = (error) =>
    process.stderr.write(`Allowance MCP transport error: ${error.message}\n`);
  transport.onclose = () => runtime.close();
  process.once('SIGINT', () => void server.close().finally(() => runtime.close()));
  process.once('SIGTERM', () => void server.close().finally(() => runtime.close()));
  await server.connect(transport);
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entry && fileURLToPath(import.meta.url) === entry) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Allowance MCP failed.'}\n`);
    process.exitCode = 1;
  });
}
