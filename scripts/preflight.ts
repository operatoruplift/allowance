import { createRuntime } from '../server/runtime.js';
import { configurationReadiness, loadConfig } from '../server/config.js';
const runtime = await createRuntime(loadConfig(), { recover: false });
try {
  const [payments, data] = await Promise.allSettled([
    runtime.payments.readiness(),
    runtime.data.probe(),
  ]);
  const evidence = {
    recordedAt: new Date().toISOString(),
    kind: 'read-only preflight; no signing, LLM call or settlement',
    configuration: configurationReadiness(runtime.config),
    payments:
      payments.status === 'fulfilled'
        ? payments.value
        : { ready: false, error: 'Payment preflight unavailable' },
    data:
      data.status === 'fulfilled'
        ? data.value
        : { ready: false, error: 'Data preflight unavailable' },
  };
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  if (
    payments.status !== 'fulfilled' ||
    !payments.value.ready ||
    data.status !== 'fulfilled' ||
    !evidence.configuration.every((x) => x.ready)
  )
    process.exitCode = 1;
} finally {
  runtime.close();
}
