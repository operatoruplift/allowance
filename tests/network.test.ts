import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../server/config.js';
import { PAYMENT_CHAINS } from '../shared/domain.js';
import { openDatabase } from '../server/db/index.js';
import { Ledger } from '../server/policy/ledger.js';
import { PaymentRpc } from '../server/payments/rpc.js';
import { createRuntime } from '../server/runtime.js';

const dbs: ReturnType<typeof openDatabase>[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
  vi.unstubAllGlobals();
});
const live = {
  LIVE_PAYMENTS_ENABLED: 'true',
  PAYMENT_NETWORK: 'mainnet',
  PAYMENT_RPC_URL: PAYMENT_CHAINS.mainnet.rpcUrl,
  FACILITATOR_URL: 'https://facilitator.example',
  MAINNET_PAYMENTS_ACKNOWLEDGED: 'true',
  ALLOW_MAINNET_READ_ONLY: 'true',
};
const input = {
  wallet: '11111111111111111111111111111111',
  task: 'Explain wallet activity.',
  allowance: '0.04',
  perRequestCap: '0.02',
  expiresInMinutes: 10,
  allowedTools: ['wallet_snapshot' as const, 'transaction_explain' as const],
};

describe('explicit payment network configuration', () => {
  it('defaults to mainnet with signing and data reads disabled and boots without network access', async () => {
    const config = loadConfig({});
    expect(config).toMatchObject({
      paymentNetwork: 'mainnet',
      dataNetwork: 'mainnet',
      liveEnabled: false,
      allowMainnetReadOnly: false,
      paymentRpcUrl: PAYMENT_CHAINS.mainnet.rpcUrl,
    });
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetcher);
    const runtime = await createRuntime({ ...config, databasePath: ':memory:' });
    try {
      expect((await runtime.payments.readiness()).ready).toBe(false);
      await expect(runtime.data.probe()).rejects.toThrow(/ALLOW_MAINNET_READ_ONLY/);
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      runtime.close();
    }
  });
  it.each([
    'PAYMENT_NETWORK',
    'PAYMENT_RPC_URL',
    'FACILITATOR_URL',
    'MAINNET_PAYMENTS_ACKNOWLEDGED',
  ])('refuses live mainnet without explicit %s', (field) => {
    expect(() => loadConfig({ ...live, [field]: '' })).toThrow();
  });
  it('accepts reviewed mainnet and explicit devnet, with independent data selection', () => {
    expect(loadConfig(live)).toMatchObject({
      liveEnabled: true,
      paymentNetwork: 'mainnet',
      dataNetwork: 'mainnet',
    });
    expect(
      loadConfig({ ...live, PAYMENT_NETWORK: 'devnet', DATA_NETWORK: 'mainnet' })
    ).toMatchObject({ paymentNetwork: 'devnet', dataNetwork: 'mainnet' });
    expect(() => loadConfig({ PAYMENT_NETWORK: 'testnet' })).toThrow(/PAYMENT_NETWORK/);
    expect(() => loadConfig({ ...live, PAYMENT_RPC_URL: 'http://insecure.example' })).toThrow(
      /HTTPS/
    );
  });
  it('retains historical devnet policy and receipts when a database is opened for mainnet', () => {
    const db = openDatabase(':memory:');
    dbs.push(db);
    const legacy = new Ledger(
      db,
      loadConfig({ PAYMENT_NETWORK: 'devnet', MERCHANT_RECIPIENT: input.wallet })
    );
    const old = legacy.createRun(input);
    const priorPolicy = JSON.stringify(old.policy);
    legacy.stop(old.id);
    const mainnet = new Ledger(db, loadConfig({ MERCHANT_RECIPIENT: input.wallet }));
    expect(mainnet.getRun(old.id).paymentNetwork).toBe('devnet');
    expect(JSON.stringify(mainnet.getRun(old.id).policy)).toBe(priorPolicy);
    const next = mainnet.createRun(input);
    expect(next.paymentNetwork).toBe('mainnet');
    expect(next.policy).toMatchObject({
      network: PAYMENT_CHAINS.mainnet.network,
      mint: PAYMENT_CHAINS.mainnet.mint,
    });
  });
  it('denies signing an existing devnet reservation after network configuration changes', () => {
    const db = openDatabase(':memory:');
    dbs.push(db);
    const config = loadConfig({ PAYMENT_NETWORK: 'devnet', MERCHANT_RECIPIENT: input.wallet });
    const ledger = new Ledger(db, config);
    const run = ledger.createRun(input);
    const reserved = ledger.reserve({
      runId: run.id,
      requestId: 'existing-devnet-purchase',
      canonicalHash: 'old',
      tool: 'wallet_snapshot',
      amount: '10000',
      origin: config.origin,
      path: '/merchant/wallet-snapshot',
      method: 'POST',
      recipient: config.recipient,
      network: PAYMENT_CHAINS.devnet.network,
      mint: PAYMENT_CHAINS.devnet.mint,
    });
    const changed = new Ledger(db, { ...config, paymentNetwork: 'mainnet' });
    expect(() => changed.checkBeforeSign(reserved.intent.id)).toThrow(/immutable policy/);
    expect(changed.getRun(run.id)).toMatchObject({ paymentNetwork: 'devnet', held: '10000' });
  });
  it('rejects a wrong-cluster RPC before account reads and checks genesis again before signing', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(
        async () => new Response(JSON.stringify({ result: PAYMENT_CHAINS.devnet.genesisHash }))
      );
    const rpc = new PaymentRpc('https://rpc.example', 'mainnet', fetcher);
    await expect(rpc.preflight(input.wallet, PAYMENT_CHAINS.mainnet.mint)).rejects.toThrow(
      /not Solana mainnet/
    );
    await expect(rpc.validateLifetimeAndFee(new Uint8Array(), 'blockhash', 15000)).rejects.toThrow(
      /not Solana mainnet/
    );
    expect(fetcher.mock.calls.map((call) => JSON.parse(String(call[1]?.body)).method)).toEqual([
      'getGenesisHash',
      'getGenesisHash',
    ]);
  });
});
