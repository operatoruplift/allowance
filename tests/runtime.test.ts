import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { loadConfig } from '../server/config.js';
import { createRuntime } from '../server/runtime.js';
import { assertServiceLeaseActive } from '../server/db/lease.js';
import { PAYMENT_CHAINS } from '../shared/domain.js';

const roots: string[] = [];
const runtimes: Awaited<ReturnType<typeof createRuntime>>[] = [];
afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.close();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function config() {
  const root = fs.mkdtempSync(path.join(tmpdir(), 'allowance-runtime-'));
  roots.push(root);
  return {
    ...loadConfig({
      PAYMENT_NETWORK: 'devnet',
      MERCHANT_RECIPIENT: '11111111111111111111111111111111',
    }),
    databasePath: path.join(root, 'journal.sqlite'),
  };
}
const input = {
  wallet: '11111111111111111111111111111111',
  task: 'Test shutdown fencing',
  allowance: '0.04',
  perRequestCap: '0.02',
  expiresInMinutes: 10,
  allowedTools: ['wallet_snapshot' as const],
};

it('fences shared signing before draining, releases unsigned work and persists original signed holds across restart', async () => {
  const cfg = config();
  const runtime = await createRuntime(cfg);
  runtimes.push(runtime);
  const run = runtime.ledger.createRun(input);
  const proposal = {
    runId: run.id,
    requestId: 'signed',
    canonicalHash: 'signed',
    tool: 'wallet_snapshot' as const,
    amount: '10000',
    origin: cfg.origin,
    path: '/merchant/wallet-snapshot',
    method: 'POST' as const,
    recipient: cfg.recipient,
    network: PAYMENT_CHAINS.devnet.network,
    mint: PAYMENT_CHAINS.devnet.mint,
  };
  runtime.ledger.reserve(proposal);
  runtime.ledger.reserve({ ...proposal, requestId: 'unsigned', canonicalHash: 'unsigned' });
  runtime.ledger.markSigning('signed', {
    messageHash: 'fixture-message',
    blockhash: 'fixture-blockhash',
    payer: 'fixture-payer',
    feeSponsor: 'fixture-sponsor',
  });
  runtime.db
    .prepare('INSERT INTO sessions VALUES(?,?,?)')
    .run('persisted-session', Date.now() + 60000, '{}');
  runtime.beginShutdown();
  expect(() => assertServiceLeaseActive(runtime.db)).toThrow(/not active/);
  expect(() => runtime.ledger.checkBeforeSign('signed')).toThrow(/ownership expired/);
  expect(runtime.ledger.getRun(run.id)).toMatchObject({
    status: 'stopped',
    held: '10000',
    remaining: '30000',
  });
  expect(runtime.ledger.getIntent('unsigned')?.status).toBe('released');
  runtime.close();
  runtime.close();
  const restarted = await createRuntime(cfg);
  runtimes.push(restarted);
  expect(restarted.ledger.getRun(run.id)).toMatchObject({
    status: 'stopped',
    held: '10000',
    remaining: '30000',
  });
  expect(restarted.ledger.getIntent('signed')?.status).toBe('settlement-unknown');
  expect(restarted.db.prepare('SELECT sid FROM sessions').get()).toEqual({
    sid: 'persisted-session',
  });
});

it('cleans up its lease when initialization fails, allowing corrected startup immediately', async () => {
  const cfg = config();
  await expect(
    createRuntime({ ...cfg, facilitatorUrl: 'http://insecure.example' })
  ).rejects.toThrow(/HTTPS/);
  const corrected = await createRuntime(cfg);
  runtimes.push(corrected);
  expect(corrected.db.open).toBe(true);
});

it('preflight-style startup neither takes service ownership nor interrupts active runs', async () => {
  const cfg = config();
  const owner = await createRuntime(cfg);
  runtimes.push(owner);
  const run = owner.ledger.createRun(input);
  const readOnly = await createRuntime(cfg, { recover: false });
  runtimes.push(readOnly);
  expect(() => readOnly.ledger.createRun(input)).toThrow(/Read-only runtime/);
  readOnly.close();
  expect(owner.ledger.getRun(run.id).status).toBe('queued');
  expect(() => assertServiceLeaseActive(owner.db)).not.toThrow();
});

it('a stale process shutdown cannot stop a replacement service run', async () => {
  const cfg = config();
  const stale = await createRuntime(cfg);
  runtimes.push(stale);
  stale.db.prepare('UPDATE service_lease SET expires=0').run();
  const replacement = await createRuntime(cfg);
  runtimes.push(replacement);
  const run = replacement.ledger.createRun(input);
  stale.beginShutdown();
  expect(replacement.ledger.getRun(run.id).status).toBe('queued');
  expect(() => assertServiceLeaseActive(replacement.db)).not.toThrow();
});

it('rejects a second service in a real process while the authoritative lease is live', async () => {
  const cfg = config();
  const runtime = await createRuntime(cfg);
  runtimes.push(runtime);
  const index = pathToFileURL(path.resolve('server/db/index.ts')).href;
  const lease = pathToFileURL(path.resolve('server/db/lease.ts')).href;
  const script = `import {openDatabase} from ${JSON.stringify(index)}; import {acquireServiceLease} from ${JSON.stringify(lease)}; const db=openDatabase(process.env.TEST_JOURNAL); try { acquireServiceLease(db); process.exitCode=2; } catch(e) { if(!e.message.includes('Another Allowance')) throw e; process.stdout.write('lease-denied'); } finally {db.close();}`;
  const result = await promisify(execFile)(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '-e', script],
    { env: { ...process.env, TEST_JOURNAL: cfg.databasePath } }
  );
  expect(result.stdout).toBe('lease-denied');
});
