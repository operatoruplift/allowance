import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { generateKeyPairSigner } from '@solana/kit';
import { createRuntime } from '../server/runtime.js';
import { loadConfig } from '../server/config.js';
import { addressSchema, formatMoney } from '../shared/domain.js';

/**
 * Funded devnet proof for the direct rail. Opt-in only: it moves 0.010000 devnet
 * USDC from the configured payer to a recipient, records a blocked probe to an
 * unlisted address first, and writes dated evidence with no secrets.
 *
 *   npm run smoke:direct-devnet -- --confirm-devnet-spend [--recipient <address>]
 */
if (!process.argv.includes('--confirm-devnet-spend')) {
  process.stderr.write(
    'Not run. This command spends 0.010000 test devnet USDC plus SOL fees from the configured payer. Opt in with: npm run smoke:direct-devnet -- --confirm-devnet-spend\n'
  );
  process.exit(2);
}
const config = loadConfig();
if (!config.directEnabled || config.paymentNetwork !== 'devnet')
  throw new Error('This script requires DIRECT_PAYMENTS_ENABLED=true and PAYMENT_NETWORK=devnet.');
const index = process.argv.indexOf('--recipient');
const recipient =
  index === -1 ? (await generateKeyPairSigner()).address : addressSchema.parse(process.argv[index + 1]);
const runtime = await createRuntime(config, { recover: false, exclusive: true });
let exitCode = 0;
try {
  const readiness = await runtime.direct.readiness();
  if (!readiness.ready)
    throw new Error(
      `Direct payment preflight not ready: ${readiness.items.filter((x) => !x.ready).map((x) => `${x.name} (${x.detail})`).join('; ')}`
    );
  const mandate = runtime.mandates.create(
    {
      label: 'Devnet smoke',
      perRequestCap: '0.010000',
      ceiling: '0.020000',
      expiresInMinutes: 10,
      recipients: [{ address: recipient, label: 'Smoke recipient' }],
    },
    readiness.payer!
  );
  runtime.mandates.event(mandate.id, 'smoke', 'Scripted devnet smoke', 'One blocked probe, then one settled transfer.', 'system');
  const unlisted = (await generateKeyPairSigner()).address;
  const blocked = await runtime.direct.pay(mandate.id, { requestId: randomUUID(), recipient: unlisted, amount: '0.010000' }, 'smoke');
  if (blocked.status !== 'denied' || blocked.reasonCode !== 'recipient-not-allowlisted')
    throw new Error(`The unlisted probe was not blocked: ${JSON.stringify(blocked)}`);
  const started = Date.now();
  let payment = await runtime.direct.pay(mandate.id, { requestId: randomUUID(), recipient, amount: '0.010000', memo: 'smoke' }, 'smoke');
  // Give a slow devnet confirmation up to two more reconciliation passes.
  for (let attempt = 0; attempt < 4 && payment.status === 'submitted'; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    await runtime.direct.reconcile();
    payment = runtime.mandates.getPayment(payment.id)!;
  }
  const receipt = runtime.mandates.get(mandate.id);
  const evidence = {
    recordedAt: new Date().toISOString(),
    kind: 'funded devnet direct-payment smoke; one blocked probe and one real transfer',
    paymentNetwork: config.paymentNetwork,
    rpc: new URL(config.paymentRpcUrl).host,
    payer: readiness.payer,
    recipient,
    durationMs: Date.now() - started,
    blockedProbe: { status: blocked.status, reasonCode: blocked.reasonCode, chainCalls: 'none' },
    payment,
    mandate: { id: receipt.id, policyHash: receipt.policyHash, settled: receipt.settled, held: receipt.held, remaining: receipt.remaining, events: receipt.events },
  };
  await fs.mkdir('evidence', { recursive: true });
  const file = `evidence/direct-devnet-smoke-${evidence.recordedAt.replace(/[:.]/g, '-')}.json`;
  await fs.writeFile(file, `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(
    `${payment.status === 'settled' ? 'SETTLED' : payment.status.toUpperCase()} ${formatMoney(payment.amount)} devnet USDC to ${recipient}\n${payment.explorerUrl ?? 'no signature'}\nEvidence: ${file}\n`
  );
  if (payment.status !== 'settled') exitCode = 1;
} finally {
  runtime.close();
}
process.exit(exitCode);
