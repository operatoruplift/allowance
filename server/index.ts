import { createRuntime } from './runtime.js';
import { createApp } from './app.js';
import { serveClient } from './frontend.js';
const runtime = await createRuntime();
const { config, db, ledger, payments, runner, data } = runtime;
const app = createApp(config, db, ledger, payments, runner, () => data.probe());
let closeFrontend: (() => Promise<void>) | undefined;
if (config.production) {
  serveClient(app, 'dist/client');
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
  closeFrontend = () => vite.close();
}
const server = app.listen(config.port, config.host, () => {
  process.stdout.write(
    `Allowance available at ${config.origin}. Rehearsal: /demo. Live spending requires operator configuration and explicit network opt-in.\n`
  );
});
server.on('error', () => {
  runtime.close();
  process.stderr.write('Could not bind Allowance port. Choose an unused local port.\n');
  process.exit(1);
});
server.requestTimeout = 30000;
server.headersTimeout = 35000;
let reconciling = false;
const reconciliation = setInterval(() => {
  if (reconciling) return;
  reconciling = true;
  void payments
    .reconcile()
    .catch(() => {
      process.stderr.write('Payment reconciliation unavailable; unresolved funds remain held.\n');
    })
    .finally(() => {
      reconciling = false;
    });
}, 30000);
reconciliation.unref();
let closing = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    if (closing) return;
    closing = true;
    clearInterval(reconciliation);
    runtime.beginShutdown();
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      runtime.close();
      process.exit(0);
    };
    void closeFrontend?.().catch(() => undefined);
    // Let original in-flight requests persist their outcome while signing is fenced.
    let drained = false;
    server.close(() => {
      drained = true;
    });
    const drain = setInterval(() => {
      if (drained && !reconciling && !runner?.isBusy()) {
        clearInterval(drain);
        finish();
      }
    }, 50);
    setTimeout(() => {
      clearInterval(drain);
      server.closeAllConnections();
      finish();
    }, 30000).unref();
  });
