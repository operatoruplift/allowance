import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import express from 'express';
import argon2 from 'argon2';
import { createApp, type RuntimePayments } from '../../server/app.js';
import { loadConfig } from '../../server/config.js';
import { openDatabase } from '../../server/db/index.js';
import { Ledger } from '../../server/policy/ledger.js';

const testDirectory = process.env.ALLOWANCE_PRIVATE_TEST_DIR;
const testPassword = process.env.ALLOWANCE_PRIVATE_TEST_PASSWORD;
const testPort = process.env.ALLOWANCE_PRIVATE_TEST_PORT || '4319';
if (
  !testDirectory ||
  !testPassword ||
  !path.basename(testDirectory).startsWith('allowance-browser-')
)
  throw new Error('This harness requires an isolated browser-test directory and password.');

// This harness exercises auth and persistence only. There is no payment or model runtime.
globalThis.fetch = async () => {
  throw new Error('External network is disabled in the controlled browser auth test.');
};
const config = loadConfig({
  NODE_ENV: 'production',
  PORT: testPort,
  APP_ORIGIN: `http://127.0.0.1:${testPort}`,
  DATABASE_PATH: path.join(testDirectory, 'private.sqlite'),
  OPERATOR_PASSWORD_HASH: await argon2.hash(testPassword, {
    type: argon2.argon2id,
    memoryCost: 8192,
    timeCost: 1,
  }),
  SESSION_SECRET: randomBytes(48).toString('hex'),
  LIVE_PAYMENTS_ENABLED: 'false',
});
const db = openDatabase(config.databasePath);
const ledger = new Ledger(db, config);
const run = ledger.createRun({
  wallet: '11111111111111111111111111111111',
  task: 'Controlled browser auth test: no purchases or live settlement.',
  allowance: '0.040000',
  perRequestCap: '0.020000',
  expiresInMinutes: 30,
  allowedTools: ['wallet_snapshot', 'transaction_explain'],
});
const disabled = async (): Promise<never> => {
  throw new Error('External services are disabled in the controlled browser auth test.');
};
const payments: RuntimePayments = {
  mountMerchant: () => {},
  runPaidTool: disabled,
  reconcile: disabled,
  readiness: async () => ({
    ready: false,
    items: [{ name: 'Controlled browser auth test', ready: false, detail: 'Payments disabled.' }],
    payer: null,
    balance: { usdc: null, sol: null },
  }),
};
const app = createApp(config, db, ledger, payments, null, disabled);
app.use(express.static(path.resolve('dist/client'), { index: false }));
app.get('/{*path}', (_req, res) => res.sendFile(path.resolve('dist/client/index.html')));
const server = createServer(app);
server.on('error', (error) => {
  db.close();
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
server.listen(config.port, config.host, () => {
  process.stdout.write(`${JSON.stringify({ ready: true, runId: run.id })}\n`);
});
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    server.closeAllConnections();
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
