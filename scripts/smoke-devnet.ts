import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { z } from 'zod';
import { createRuntime } from '../server/runtime.js';
import { loadConfig } from '../server/config.js';
import { addressSchema, signatureSchema, DEFAULT_TASK } from '../shared/domain.js';
if (!process.argv.includes('--confirm-devnet-spend')) {
  process.stderr.write(
    'Not run. This command can spend 0.030000 test devnet USDC and requires a dedicated funded devnet key, separate recipient, trusted sponsor, and DEMO_WALLET. Opt in with: npm run smoke:devnet -- --confirm-devnet-spend\n'
  );
  process.exit(2);
}
const config = loadConfig();
if (!config.liveEnabled)
  throw new Error('Set LIVE_PAYMENTS_ENABLED=true explicitly. Only devnet is supported.');
const wallet = addressSchema.parse(config.defaultWallet);
if (!['localhost', '127.0.0.1'].includes(new URL(config.origin).hostname))
  throw new Error(
    'Standalone smoke command requires the exact local merchant origin. Hosted run uses the authenticated operator console.'
  );
const runtime = await createRuntime(config, { recover: false, exclusive: true });
const app = express();
app.use(express.json({ limit: '24kb' }));
runtime.payments.mountMerchant(app);
const server = app.listen(config.port, config.host);
await new Promise<void>((resolve, reject) => {
  server.once('listening', resolve);
  server.once('error', reject);
});
let runId: string | undefined;
try {
  const readiness = await runtime.payments.readiness();
  if (!readiness.ready)
    throw new Error(
      `Preflight not ready: ${readiness.items
        .filter((x) => !x.ready)
        .map((x) => x.name)
        .join(', ')}`
    );
  await runtime.data.probe();
  // This is an explicit scripted live integration check, separate from an autonomous model trace.
  const run = runtime.ledger.createRun({
    wallet,
    task: DEFAULT_TASK,
    allowance: '0.040000',
    perRequestCap: '0.020000',
    expiresInMinutes: 10,
    allowedTools: ['wallet_snapshot', 'transaction_explain'],
  });
  runId = run.id;
  runtime.ledger.setStatus(run.id, 'running');
  runtime.ledger.event(
    run.id,
    'smoke',
    'Scripted live smoke test',
    'No LLM call. Two actual HTTP purchases then a separate policy probe.',
    'system'
  );
  const snapshot = await runtime.payments.runPaidTool(run.id, randomUUID(), 'wallet_snapshot', {
    address: wallet,
  });
  const parsed = z
    .object({ recentSignatures: z.array(z.object({ signature: signatureSchema })).min(2) })
    .parse(snapshot);
  await runtime.payments.runPaidTool(run.id, randomUUID(), 'transaction_explain', {
    signature: parsed.recentSignatures[0].signature,
  });
  runtime.ledger.setStatus(run.id, 'completed');
  runtime.ledger.probe(run.id);
  const receipt = runtime.ledger.getRun(run.id);
  const purchases = receipt.purchases.filter((p) => p.source === 'agent');
  const demonstrated =
    receipt.settled === '30000' &&
    receipt.remaining === '10000' &&
    receipt.held === '0' &&
    purchases.length === 2 &&
    purchases.every((p) => p.chainVerified && p.status === 'delivered') &&
    receipt.purchases.some((p) => p.source === 'policy-probe' && p.status === 'denied');
  runtime.ledger.setReport(
    run.id,
    'Scripted devnet integration check. Wallet facts and transaction explanation appear in the purchased results. This is not an autonomous LLM trace.'
  );
  await fs.mkdir('evidence', { recursive: true });
  const filename = `evidence/devnet-smoke-${new Date().toISOString().replaceAll(':', '-')}.json`;
  await fs.writeFile(
    filename,
    JSON.stringify(
      {
        recordedAt: new Date().toISOString(),
        execution: 'scripted live devnet smoke; no LLM',
        demonstrated,
        receipt: runtime.ledger.getRun(run.id),
      },
      null,
      2
    )
  );
  process.stdout.write(
    `Evidence saved to ${filename}. Required scenario chain-verified: ${demonstrated}.\n`
  );
  if (!demonstrated) process.exitCode = 1;
} catch (error) {
  if (runId) {
    runtime.ledger.setStatus(
      runId,
      'failed',
      'Live smoke did not complete. Inspect durable receipt; do not blindly retry uncertain payments.'
    );
    process.stderr.write(`Inspect run ${runId}; existing payments remain recorded.\n`);
  }
  process.stderr.write(`${error instanceof Error ? error.message : 'Smoke failed.'}\n`);
  process.exitCode = 1;
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  runtime.close();
}
