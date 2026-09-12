import type { ToolName } from '../shared/domain.js';
import type { PaymentLedger } from '../server/payments/contracts.js';
/** Server-side SDK-style reuse. A caller must create an authorized run first. */
export async function runPaidTool(
  client: {
    runPaidTool(runId: string, requestId: string, tool: ToolName, args: unknown): Promise<unknown>;
  },
  ledger: PaymentLedger,
  purchase: { runId: string; requestId: string; tool: ToolName; args: unknown }
) {
  const data = await client.runPaidTool(
    purchase.runId,
    purchase.requestId,
    purchase.tool,
    purchase.args
  );
  return { purchase: ledger.getIntent(purchase.requestId), data };
}
