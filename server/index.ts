import path from 'node:path';
import express from 'express';
import { createRuntime } from './runtime.js';
import { createApp } from './app.js';
const runtime = await createRuntime();
const { config, db, ledger, payments, runner, data } = runtime;
const app = createApp(config, db, ledger, payments, runner, () => data.probe());
let closeFrontend: (() => Promise<void>) | undefined;
if (config.production) {
  app.use(express.static(path.resolve('dist/client'), { index: false }));
  app.get('/{*path}', (_req, res) => res.sendFile(path.resolve('dist/client/index.html')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
  closeFrontend = () => vite.close();
}
const server = app.listen(config.port, config.host, () => {
  process.stdout.write(
    `Allowance available at ${config.origin}. Rehearsal: /demo. Live spending requires operator configuration and devnet opt-in.\n`
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
    const finish = () => {
      runtime.close();
      process.exit(0);
    };
    void closeFrontend?.().catch(() => undefined);
    server.closeAllConnections();
    server.close(finish);
    setTimeout(finish, 2000).unref();
  });
