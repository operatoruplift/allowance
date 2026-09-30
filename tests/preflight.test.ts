import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { address, generateKeyPairSigner } from '@solana/kit';
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import { runPreflight, parsePreflightRail } from '../server/preflight.js';
import { loadConfig } from '../server/config.js';
import { openDatabase } from '../server/db/index.js';
import { acquireServiceLease } from '../server/db/lease.js';
import { Ledger } from '../server/policy/ledger.js';
import { SolanaDataClient } from '../server/data/solana.js';
import { createPaymentService } from '../server/payments/index.js';
import { loadPayerSigner } from '../server/payments/keypair.js';
import { PAYMENT_CHAINS } from '../shared/domain.js';
import { FakeChain } from './fixtures/direct-chain.js';

vi.mock('../server/payments/keypair.js', () => ({ loadPayerSigner: vi.fn() }));
const roots: string[] = [];
const dbs: ReturnType<typeof openDatabase>[] = [];
afterEach(() => {
  dbs.splice(0).forEach((db) => db.open && db.close());
  roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true }));
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
function root() {
  const directory = fs.mkdtempSync(path.join(tmpdir(), 'allowance-preflight-'));
  roots.push(directory);
  return directory;
}
async function fixture() {
  const payer = await generateKeyPairSigner();
  const recipient = await generateKeyPairSigner();
  const sponsor = await generateKeyPairSigner();
  const signTransactions = vi.fn(async () => {
    throw new Error('Preflight must never sign.');
  });
  const signMessages = vi.fn(async () => {
    throw new Error('Preflight must never sign.');
  });
  vi.mocked(loadPayerSigner).mockResolvedValue({ ...payer, signTransactions, signMessages });
  const config = loadConfig({
    DATABASE_PATH: path.join(root(), 'journal.sqlite'),
    OPERATOR_PASSWORD_HASH: '$argon2id$controlled-preflight-fixture',
    SESSION_SECRET: 'controlled-session-fixture-32-characters',
    PAYMENT_NETWORK: 'devnet',
    PAYMENT_RPC_URL: 'https://payment.invalid',
    DATA_RPC_URL: 'https://data.invalid',
    DIRECT_PAYMENTS_ENABLED: 'true',
    PAYER_SECRET_JSON: 'in-process-fixture-only',
    FACILITATOR_URL: 'https://facilitator.invalid',
    MERCHANT_RECIPIENT: recipient.address,
    TRUSTED_FEE_PAYER: sponsor.address,
    OPENAI_API_KEY: 'in-process-fixture-only',
    OPENAI_MODEL: 'fixture-model',
  });
  const db = openDatabase(config.databasePath);
  dbs.push(db);
  const ledger = new Ledger(db, config);
  await createPaymentService(
    {
      enabled: false,
      network: 'devnet',
      merchantOrigin: config.origin,
      recipient: config.recipient,
      trustedFeeSponsor: config.trustedFeePayer,
      facilitatorUrl: config.facilitatorUrl,
      allowLocalHttp: true,
    },
    ledger,
    new SolanaDataClient({ rpcUrl: config.dataRpcUrl, cluster: 'devnet' })
  );
  acquireServiceLease(db);
  const chain = new FakeChain();
  const mint = PAYMENT_CHAINS.devnet.mint;
  for (const owner of [payer, recipient]) {
    const [account] = await findAssociatedTokenPda({
      owner: owner.address,
      mint: address(mint),
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });
    chain.fund(String(account), owner.address, 100_000n);
  }
  chain.lamports.set(payer.address, 10_000_000n);
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    if (String(input) === 'https://facilitator.invalid/supported')
      return Response.json({
        kinds: [
          {
            x402Version: 2,
            scheme: 'exact',
            network: PAYMENT_CHAINS.devnet.network,
            extra: { feePayer: sponsor.address },
          },
        ],
        extensions: [],
        signers: {},
      });
    if (
      !['https://payment.invalid', 'https://data.invalid'].includes(
        String(input).replace(/\/$/, '')
      )
    )
      throw new Error('Unexpected endpoint; external network is forbidden.');
    const { id, method, params } = JSON.parse(String(init?.body));
    if (!['getGenesisHash', 'getAccountInfo', 'getBalance', 'getLatestBlockhash'].includes(method))
      throw new Error('Preflight attempted a non-read method.');
    const result =
      method === 'getAccountInfo' && params[0] === mint
        ? {
            value: {
              owner: TOKEN_PROGRAM_ADDRESS,
              data: { parsed: { type: 'mint', info: { decimals: 6, isInitialized: true } } },
            },
          }
        : await chain.call(method, params);
    return Response.json({ jsonrpc: '2.0', id, result });
  });
  vi.stubGlobal('fetch', fetcher);
  const state = () => ({
    schema: db.prepare('SELECT * FROM sqlite_schema ORDER BY name').all(),
    migrations: db.prepare('SELECT * FROM schema_migrations').all(),
    lease: db.prepare('SELECT * FROM service_lease').all(),
    runs: db.prepare('SELECT * FROM runs').all(),
    intents: db.prepare('SELECT * FROM intents').all(),
    events: db.prepare('SELECT * FROM events').all(),
  });
  return { config, db, ledger, chain, fetcher, signTransactions, signMessages, state };
}

it('keeps x402 as the default and rejects ambiguous or unknown rail arguments', () => {
  expect(parsePreflightRail([])).toBe('x402');
  for (const rail of ['x402', 'direct', 'all'] as const) {
    expect(parsePreflightRail(['--rail', rail])).toBe(rail);
    expect(parsePreflightRail([`--rail=${rail}`])).toBe(rail);
  }
  for (const args of [
    ['--rail'],
    ['--rail', 'mainnet'],
    ['direct'],
    ['--rail', 'direct', '--rail', 'all'],
  ])
    expect(() => parsePreflightRail(args)).toThrow(/Usage/);
});

it('checks a direct-only deployment without x402, data, or model prerequisites and never signs or changes the journal', async () => {
  const f = await fixture();
  const before = f.state();
  const result = await runPreflight(
    {
      ...f.config,
      recipient: '',
      trustedFeePayer: '',
      openaiApiKey: '',
      openaiModel: '',
      allowMainnetReadOnly: false,
      dataNetwork: 'mainnet',
      dataRpcUrl: 'unconfigured-data-provider',
    },
    'direct'
  );
  expect(result).toMatchObject({
    ready: true,
    rail: 'direct',
    direct: { ready: true },
    payments: { checked: false },
    data: { checked: false },
  });
  expect(f.fetcher.mock.calls.every(([url]) => String(url) === 'https://payment.invalid')).toBe(
    true
  );
  expect(f.signTransactions).not.toHaveBeenCalled();
  expect(f.signMessages).not.toHaveBeenCalled();
  expect(f.state()).toEqual(before);
});

it('preserves default x402 output and checks both rails only when requested', async () => {
  const f = await fixture();
  const config = { ...f.config, liveEnabled: true };
  const before = f.state();
  const legacy = await runPreflight({ ...config, directEnabled: false });
  expect(legacy).toMatchObject({
    ready: true,
    rail: 'x402',
    payments: { ready: true },
    data: { ready: true },
    direct: { checked: false },
  });
  expect(vi.mocked(loadPayerSigner)).toHaveBeenCalledTimes(1);
  const both = await runPreflight(config, 'all');
  expect(both).toMatchObject({
    ready: true,
    payments: { ready: true },
    direct: { ready: true },
    data: { ready: true },
  });
  expect((await runPreflight({ ...config, directEnabled: false }, 'all')).ready).toBe(false);
  expect((await runPreflight({ ...config, openaiApiKey: '' })).ready).toBe(false);
  expect(f.signTransactions).not.toHaveBeenCalled();
  expect(f.signMessages).not.toHaveBeenCalled();
  expect(f.state()).toEqual(before);
});

it('fails direct readiness for disabled signing, invalid signer, insufficient SOL, or wrong RPC network', async () => {
  const f = await fixture();
  expect((await runPreflight({ ...f.config, directEnabled: false }, 'direct')).ready).toBe(false);
  vi.mocked(loadPayerSigner).mockRejectedValueOnce(
    new Error('private diagnostic must stay private')
  );
  const invalid = await runPreflight(f.config, 'direct');
  expect(invalid.ready).toBe(false);
  expect(JSON.stringify(invalid)).not.toContain('private diagnostic');
  f.chain.lamports.clear();
  expect((await runPreflight(f.config, 'direct')).ready).toBe(false);
  const wrongNetwork = await runPreflight({ ...f.config, paymentNetwork: 'mainnet' }, 'direct');
  expect(wrongNetwork.ready).toBe(false);
  expect(f.signTransactions).not.toHaveBeenCalled();
});

it('retains pending payment holds and restore locks without startup recovery or lease changes', async () => {
  const f = await fixture();
  const run = f.ledger.createRun({
    wallet: '11111111111111111111111111111111',
    task: 'Retain original hold',
    allowance: '0.04',
    perRequestCap: '0.02',
    expiresInMinutes: 10,
    allowedTools: ['wallet_snapshot'],
  });
  f.db
    .prepare(
      'INSERT INTO intents(id,run_id,request_hash,tool,amount,status,created_at,day,source,signed_identity) VALUES(?,?,?,?,?,?,?,?,?,?)'
    )
    .run(
      'held',
      run.id,
      'held',
      'wallet_snapshot',
      10000,
      'reserved',
      new Date().toISOString(),
      '2026-09-30',
      'agent',
      '{}'
    );
  const before = f.state();
  const held = await runPreflight(f.config, 'direct');
  expect(held.ready).toBe(false);
  expect(held.configuration).toContainEqual(
    expect.objectContaining({ name: 'Payment recovery', ready: false })
  );
  expect(f.state()).toEqual(before);
  f.db
    .prepare('INSERT INTO restore_recoveries VALUES(?,?,?,?,?,?)')
    .run('restore', 'backup', '2026-09-29', '2026-09-30', null, null);
  const restored = await runPreflight(f.config, 'direct');
  expect(restored.configuration).toContainEqual(
    expect.objectContaining({ name: 'Journal recovery', ready: false })
  );
  expect(f.db.prepare('SELECT approved_at FROM restore_recoveries').get()).toEqual({
    approved_at: null,
  });
  expect(f.signTransactions).not.toHaveBeenCalled();
});

it('does not create a missing journal or migrate an outdated one', async () => {
  const missing = path.join(root(), 'missing', 'journal.sqlite');
  const fetcher = vi.fn<typeof fetch>();
  vi.stubGlobal('fetch', fetcher);
  const config = { ...loadConfig({}), databasePath: missing };
  expect((await runPreflight(config, 'direct')).ready).toBe(false);
  expect(fs.existsSync(path.dirname(missing))).toBe(false);
  const f = await fixture();
  f.db.prepare('DELETE FROM schema_migrations WHERE version=4').run();
  const before = f.state();
  const result = await runPreflight(f.config, 'all');
  expect(result).toMatchObject({
    ready: false,
    payments: { ready: false },
    direct: { ready: false },
  });
  expect(f.state()).toEqual(before);
  expect(f.fetcher).not.toHaveBeenCalled();
  expect(loadPayerSigner).not.toHaveBeenCalled();
});

it('keeps the development entry executable and returns failure without creating a missing journal', async () => {
  const missing = path.join(root(), 'untouched.sqlite');
  const result = await promisify(execFile)(
    process.execPath,
    ['--import', 'tsx', 'scripts/preflight.ts', '--rail', 'direct'],
    { env: { NODE_ENV: 'test', DATABASE_PATH: missing }, timeout: 15000 }
  ).catch((error: { code: number; stdout: string }) => error);
  expect(result).toMatchObject({ code: 1 });
  expect(JSON.parse(result.stdout)).toMatchObject({ ready: false, rail: 'direct' });
  expect(fs.existsSync(missing)).toBe(false);
});
