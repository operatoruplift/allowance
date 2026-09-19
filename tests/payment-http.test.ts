import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'node:http';
import {
  createKeyPairSignerFromPrivateKeyBytes,
  getBase58Decoder,
  type TransactionPartialSigner,
} from '@solana/kit';
import { getMintEncoder, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import type { FacilitatorClient } from '@x402/core/server';
import type { PaymentPayload, PaymentRequired, PaymentRequirements } from '@x402/core/types';
import { decodePaymentRequiredHeader, encodePaymentSignatureHeader } from '@x402/core/http';
import { ExactSvmScheme } from '@x402/svm/exact/client';
import { declarePaymentIdentifierExtension } from '@x402/extensions/payment-identifier';
import { openDatabase } from '../server/db/index.js';
import { Ledger } from '../server/policy/ledger.js';
import { loadConfig } from '../server/config.js';
import { createPaymentService, type PaymentAdapters } from '../server/payments/service.js';
import {
  canonicalRequest,
  decodePaymentTransaction,
  expectedAccounts,
  paymentMemo,
  validateRequirements,
  validateTransaction,
  verifyPayerSignature,
} from '../server/payments/guard.js';
import { PaymentRpc } from '../server/payments/rpc.js';
import {
  PAYMENT_CHAINS,
  PAYMENT_NETWORK,
  USDC_MINT,
  type PaymentNetwork,
} from '../shared/domain.js';
import { snapshotFixture, explanationFixture } from './fixtures/tool-results.js';
const servers: Server[] = [];
const dbs: ReturnType<typeof openDatabase>[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const s of servers.splice(0)) {
    s.closeAllConnections();
    await new Promise<void>((resolve) => s.close(() => resolve()));
  }
  for (const db of dbs.splice(0)) if (db.open) db.close();
});
const signature = getBase58Decoder().decode(new Uint8Array(64).fill(31));
const otherSignature = getBase58Decoder().decode(new Uint8Array(64).fill(32));
async function listen(app: express.Express) {
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const info = server.address();
  if (!info || typeof info === 'string') throw Error('No port.');
  return `http://127.0.0.1:${info.port}`;
}
async function setup(
  options: {
    network?: PaymentNetwork;
    rpcNetwork?: PaymentNetwork;
    facilitatorNetwork?: PaymentNetwork;
    dropResponse?: boolean;
    throwAfterSettlement?: boolean;
    scheme?: PaymentAdapters['scheme'];
  } = {}
) {
  const network = options.network ?? 'devnet';
  const chain = PAYMENT_CHAINS[network];
  const key = await createKeyPairSignerFromPrivateKeyBytes(new Uint8Array(32).fill(7));
  const recipientKey = await createKeyPairSignerFromPrivateKeyBytes(new Uint8Array(32).fill(8));
  const sponsorKey = await createKeyPairSignerFromPrivateKeyBytes(new Uint8Array(32).fill(9));
  const payer = String(key.address),
    recipient = String(recipientKey.address),
    sponsor = String(sponsorKey.address);
  const accounts = await expectedAccounts(payer, recipient, chain.mint);
  const state = {
    balance: '1000000',
    genesisHash: PAYMENT_CHAINS[options.rpcNetwork ?? network].genesisHash as string,
    supportedNetwork: PAYMENT_CHAINS[options.facilitatorNetwork ?? network].network,
    facilitatorAvailable: true,
    dropResponse: options.dropResponse ?? false,
    throwAfterSettlement: options.throwAfterSettlement ?? false,
    landed: false,
    fee: 10001,
    valid: true,
    corruptDelivery: false,
  };
  const app = express();
  app.use(express.json({ limit: '32kb' }));
  const origin = await listen(app);
  const rpcCalls: string[] = [];
  const mint = Buffer.from(
    getMintEncoder().encode({
      mintAuthority: null,
      supply: 1000000n,
      decimals: 6,
      isInitialized: true,
      freezeAuthority: null,
    })
  ).toString('base64');
  app.post('/rpc', (req, res) => {
    const { method, params } = req.body as { method: string; params: unknown[] };
    rpcCalls.push(method);
    let result: unknown;
    if (method === 'getGenesisHash') result = state.genesisHash;
    else if (method === 'getAccountInfo') {
      const account = params[0];
      const encoding = (params[1] as { encoding?: string })?.encoding;
      const info =
        account === chain.mint
          ? { decimals: 6, isInitialized: true }
          : {
              mint: chain.mint,
              owner: account === accounts.source ? payer : recipient,
              state: 'initialized',
              tokenAmount: { amount: state.balance, decimals: 6 },
            };
      result = {
        context: { slot: 100 },
        value: {
          owner: TOKEN_PROGRAM_ADDRESS,
          lamports: 2039280,
          executable: false,
          rentEpoch: 0,
          space: 82,
          data:
            encoding === 'base64'
              ? [mint, 'base64']
              : {
                  parsed: { type: account === chain.mint ? 'mint' : 'account', info },
                  program: 'spl-token',
                  space: 82,
                },
        },
      };
    } else if (method === 'getBalance') result = { context: { slot: 100 }, value: 100000000 };
    else if (method === 'getLatestBlockhash')
      result = {
        context: { slot: 100 },
        value: { blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 999999 },
      };
    else if (method === 'isBlockhashValid') result = { context: { slot: 100 }, value: state.valid };
    else if (method === 'getFeeForMessage') result = { context: { slot: 100 }, value: state.fee };
    else if (method === 'getSignaturesForAddress') result = [];
    else if (method === 'getTransaction') result = null;
    else {
      res.status(400).json({ error: `Unexpected test RPC method: ${method}` });
      return;
    }
    res.json({ jsonrpc: '2.0', id: req.body.id, result });
  });
  let lastPayload: PaymentPayload | undefined;
  const verify = vi.fn(async (payload: PaymentPayload) => {
    verifyPayerSignature(payload);
    return { isValid: true, payer: sponsor };
  });
  const settle = vi.fn(async (payload: PaymentPayload) => {
    lastPayload = payload;
    state.landed = true;
    if (state.throwAfterSettlement) throw Error('Controlled response loss after broadcast.');
    return { success: true, transaction: signature, network: chain.network, payer: sponsor };
  });
  const facilitator: FacilitatorClient = {
    verify,
    settle,
    getSupported: async () => {
      if (!state.facilitatorAvailable) throw Error('Controlled outage.');
      return {
        kinds: [
          {
            x402Version: 2,
            scheme: 'exact',
            network: state.supportedNetwork,
            extra: { feePayer: sponsor },
          },
        ],
        extensions: [],
        signers: { 'solana:*': [sponsor] },
      };
    },
  };
  const sign = vi.fn(key.signTransactions.bind(key));
  const signer: TransactionPartialSigner = { address: key.address, signTransactions: sign };
  const db = openDatabase(':memory:');
  dbs.push(db);
  const rootConfig = loadConfig({
    PAYMENT_NETWORK: network,
    APP_ORIGIN: origin,
    MERCHANT_RECIPIENT: recipient,
  });
  const ledger = new Ledger(db, rootConfig);
  const run = ledger.createRun({
    wallet: payer,
    task: 'Explain this wallet recent activity.',
    allowance: '0.04',
    perRequestCap: '0.02',
    expiresInMinutes: 10,
    allowedTools: ['wallet_snapshot', 'transaction_explain'],
  });
  ledger.setStatus(run.id, 'running');
  const config = {
    enabled: true,
    network,
    merchantOrigin: origin,
    recipient,
    rpcUrl: `${origin}/rpc`,
    facilitatorUrl: 'https://x402.org/facilitator',
    trustedFeeSponsor: sponsor,
    allowLocalHttp: true,
    maxFeeLamports: 15000,
  };
  const data = {
    walletSnapshot: vi.fn(async (address: string) =>
      snapshotFixture(address, [signature, otherSignature], network)
    ),
    transactionExplain: vi.fn(async (value: string) => explanationFixture(value, payer, network)),
  };
  const fetcher: typeof fetch = async (input, init) => {
    const response = await fetch(input, init);
    if (state.corruptDelivery && new Headers(init?.headers).has('payment-signature')) {
      state.corruptDelivery = false;
      await response.body?.cancel();
      return new Response(JSON.stringify(snapshotFixture(recipient, [signature], network)), {
        status: response.status,
        headers: response.headers,
      });
    }
    if (state.dropResponse && new Headers(init?.headers).has('payment-signature')) {
      state.dropResponse = false;
      await response.body?.cancel();
      throw Error('Controlled paid HTTP response loss.');
    }
    return response;
  };
  const rpc = new PaymentRpc(`${origin}/rpc`, network);
  const adapters: PaymentAdapters = {
    signer,
    facilitator,
    fetch: fetcher,
    rpc,
    scheme: options.scheme,
  };
  const service = await createPaymentService(config, ledger, data, adapters);
  service.mountMerchant(app);
  return {
    service,
    ledger,
    run,
    db,
    sign,
    settle,
    verify,
    data,
    state,
    config,
    adapters,
    origin,
    payer,
    recipient,
    sponsor,
    rpc,
    rpcCalls,
    lastPayload: () => lastPayload,
  };
}
describe('actual HTTP x402 v2 middleware with controlled adapters', () => {
  it('retains the delivered result hash when independent chain proof upgrades a facilitator receipt', async () => {
    const s = await setup();
    await s.service.runPaidTool(s.run.id, 'upgrade_proof_0001', 'wallet_snapshot', {
      address: s.payer,
    });
    const before = s.ledger.getRun(s.run.id).purchases[0];
    expect(before.chainVerified).toBe(false);
    expect(before.resultHash).toMatch(/^[a-f0-9]{64}$/);
    vi.spyOn(s.rpc, 'evidence').mockResolvedValue({
      signature,
      chainVerified: true,
      slot: 123,
      feeLamports: '10001',
      feeSponsor: s.sponsor,
    });
    await s.service.reconcile();
    expect(s.ledger.getRun(s.run.id).purchases[0]).toMatchObject({
      chainVerified: true,
      resultHash: before.resultHash,
      result: before.result,
      deliveryState: 'delivered',
    });
    expect(s.sign).toHaveBeenCalledTimes(1);
  });
  it('rejects an out-of-run data identity before signing even when the payment engine is called directly', async () => {
    const s = await setup();
    await expect(
      s.service.runPaidTool(s.run.id, 'wrong_wallet_0001', 'wallet_snapshot', {
        address: s.recipient,
      })
    ).rejects.toThrow(/frozen wallet/);
    await expect(
      s.service.runPaidTool(s.run.id, 'unbought_tx_00001', 'transaction_explain', { signature })
    ).rejects.toThrow(/delivered snapshot/);
    expect(s.sign).not.toHaveBeenCalled();
  });
  it('rejects invalid merchant facts before settlement and holds the existing signed identity', async () => {
    const s = await setup();
    s.data.walletSnapshot.mockResolvedValueOnce({ arbitrary: 'unvalidated data' } as never);
    await expect(
      s.service.runPaidTool(s.run.id, 'bad_data_00000001', 'wallet_snapshot', { address: s.payer })
    ).rejects.toThrow();
    expect(s.settle).not.toHaveBeenCalled();
    expect(s.ledger.getRun(s.run.id)).toMatchObject({ held: '10000', settled: '0' });
    expect(s.ledger.getRun(s.run.id).purchases[0].serviceOutcome).toBe('pending');
    expect(s.sign).toHaveBeenCalledTimes(1);
  });
  it('separates reported settlement from wrong-wallet delivery and recovers the original cached purchase', async () => {
    const s = await setup();
    s.state.corruptDelivery = true;
    await expect(
      s.service.runPaidTool(s.run.id, 'wrong_result_0001', 'wallet_snapshot', { address: s.payer })
    ).rejects.toThrow(/response was lost/);
    expect(s.ledger.getRun(s.run.id)).toMatchObject({
      settled: '10000',
      held: '0',
      remaining: '30000',
    });
    expect(s.ledger.getRun(s.run.id).purchases[0]).toMatchObject({
      status: 'settled-but-result-unavailable',
      serviceOutcome: 'unavailable',
      chainVerified: false,
    });
    expect(s.ledger.getRun(s.run.id).purchases[0].result).toBeUndefined();
    await expect(
      s.service.runPaidTool(s.run.id, 'wrong_result_0001', 'wallet_snapshot', { address: s.payer })
    ).resolves.toMatchObject({ address: s.payer });
    expect(s.sign).toHaveBeenCalledTimes(1);
    expect(s.settle).toHaveBeenCalledTimes(1);
  });
  it('returns a genuine unpaid 402, builds real SDK Solana transactions, settles twice, and blocks the policy probe before a third signature', async () => {
    const s = await setup();
    const response = await fetch(`${s.origin}/merchant/wallet-snapshot`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-payment-id': 'unpaid_challenge_0001' },
      body: JSON.stringify({ address: s.payer }),
    });
    expect(response.status).toBe(402);
    const challenge = decodePaymentRequiredHeader(response.headers.get('payment-required')!);
    expect(challenge).toMatchObject({
      x402Version: 2,
      accepts: [{ scheme: 'exact', network: PAYMENT_NETWORK, asset: USDC_MINT, amount: '10000' }],
    });
    expect(s.sign).not.toHaveBeenCalled();
    expect(s.data.walletSnapshot).not.toHaveBeenCalled();
    expect(
      await s.service.runPaidTool(s.run.id, 'wallet_purchase_0001', 'wallet_snapshot', {
        address: s.payer,
      })
    ).toMatchObject({ address: s.payer });
    await s.service.runPaidTool(s.run.id, 'tx_purchase_0000002', 'transaction_explain', {
      signature,
    });
    s.ledger.probe(s.run.id);
    expect(s.sign).toHaveBeenCalledTimes(2);
    expect(s.settle).toHaveBeenCalledTimes(2);
    expect(s.verify).toHaveBeenCalledTimes(2);
    expect(s.ledger.getRun(s.run.id)).toMatchObject({
      settled: '30000',
      held: '0',
      remaining: '10000',
    });
    expect(
      s.ledger.getRun(s.run.id).purchases.find((p) => p.source === 'policy-probe')
    ).toMatchObject({ status: 'denied', amount: '20000' });
    expect(s.ledger.getRun(s.run.id).policy.allowance).toBe('40000');
    expect(s.rpcCalls).toContain('getLatestBlockhash');
    expect(s.rpcCalls).toContain('getFeeForMessage');
    expect(s.ledger.getRun(s.run.id).purchases.filter((p) => p.chainVerified)).toHaveLength(0);
  });
  it('deduplicates concurrent logical purchases and denies ID-only receipt theft and changed body', async () => {
    const s = await setup();
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () =>
        s.service.runPaidTool(s.run.id, 'duplicate_http_0001', 'wallet_snapshot', {
          address: s.payer,
        })
      )
    );
    expect(results.some((r) => r.status === 'fulfilled')).toBe(true);
    expect(s.sign).toHaveBeenCalledTimes(1);
    expect(s.settle).toHaveBeenCalledTimes(1);
    expect(s.ledger.getRun(s.run.id).settled).toBe('10000');
    const noPayment = await fetch(`${s.origin}/merchant/wallet-snapshot`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-payment-id': 'duplicate_http_0001' },
      body: JSON.stringify({ address: s.payer }),
    });
    expect(noPayment.status).toBe(402);
    await expect(
      s.service.runPaidTool(s.run.id, 'duplicate_http_0001', 'wallet_snapshot', {
        address: s.recipient,
      })
    ).rejects.toThrow(/conflicts/);
    const changed = await fetch(`${s.origin}/merchant/wallet-snapshot`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-payment-id': 'duplicate_http_0001',
        'payment-signature': encodePaymentSignatureHeader(s.lastPayload()!),
      },
      body: JSON.stringify({ address: s.recipient }),
    });
    expect(changed.status).toBe(400);
    expect(s.settle).toHaveBeenCalledTimes(1);
  });
  it('recovers response loss after restart even when new-spend funding and facilitator readiness fail', async () => {
    const s = await setup({ dropResponse: true });
    await expect(
      s.service.runPaidTool(s.run.id, 'response_loss_0001', 'wallet_snapshot', { address: s.payer })
    ).rejects.toThrow();
    expect(s.ledger.getRun(s.run.id)).toMatchObject({ held: '10000', settled: '0' });
    s.state.balance = '0';
    s.state.facilitatorAvailable = false;
    s.ledger.stop(s.run.id);
    s.ledger.recoverStartup();
    const restarted = await createPaymentService(s.config, s.ledger, s.data, s.adapters);
    expect((await restarted.readiness()).ready).toBe(false);
    expect(
      await restarted.runPaidTool(s.run.id, 'response_loss_0001', 'wallet_snapshot', {
        address: s.payer,
      })
    ).toMatchObject({ address: s.payer });
    expect(s.ledger.getRun(s.run.id)).toMatchObject({
      status: 'stopped',
      settled: '10000',
      held: '0',
    });
    expect(s.sign).toHaveBeenCalledTimes(1);
    expect(s.settle).toHaveBeenCalledTimes(1);
  });
  it('holds facilitator timeout, freezes payer, and uses chain evidence to recover the original cached response', async () => {
    const s = await setup({ throwAfterSettlement: true });
    await expect(
      s.service.runPaidTool(s.run.id, 'settlement_lost_01', 'wallet_snapshot', { address: s.payer })
    ).rejects.toThrow();
    expect(s.ledger.payerFrozen()).toBe(true);
    expect(s.ledger.getRun(s.run.id).held).toBe('10000');
    vi.spyOn(s.rpc, 'findSettlement').mockResolvedValue({
      signature,
      chainVerified: true,
      slot: 123,
      feeLamports: '10001',
      feeSponsor: s.sponsor,
    });
    await s.service.reconcile();
    expect(s.ledger.getRun(s.run.id)).toMatchObject({ settled: '10000', held: '0' });
    expect(s.ledger.getRun(s.run.id).purchases[0].status).toBe('delivered');
    expect(s.sign).toHaveBeenCalledTimes(1);
    expect(s.settle).toHaveBeenCalledTimes(1);
  });
  it.each(['disabled', 'restored'])(
    'observes original settlement and cached delivery without any paid replay when %s',
    async (mode) => {
      const s = await setup({ throwAfterSettlement: true });
      await expect(
        s.service.runPaidTool(s.run.id, 'readonly_recover01', 'wallet_snapshot', {
          address: s.payer,
        })
      ).rejects.toThrow();
      if (mode === 'restored')
        s.db
          .prepare(
            'INSERT INTO restore_recoveries(id,backup_id,backup_completed_at,restored_at) VALUES(?,?,?,?)'
          )
          .run(
            'fixture-restore',
            'fixture-backup',
            new Date().toISOString(),
            new Date().toISOString()
          );
      vi.spyOn(s.rpc, 'findSettlement').mockResolvedValue({
        signature,
        chainVerified: true,
        slot: 123,
        feeLamports: '10001',
        feeSponsor: s.sponsor,
      });
      const networkFetch = vi.fn<typeof fetch>();
      const readOnly = await createPaymentService(
        { ...s.config, enabled: mode !== 'disabled' },
        s.ledger,
        s.data,
        { ...s.adapters, fetch: networkFetch }
      );
      await readOnly.reconcile();
      expect(networkFetch).not.toHaveBeenCalled();
      expect(s.sign).toHaveBeenCalledTimes(1);
      expect(s.settle).toHaveBeenCalledTimes(1);
      expect(s.ledger.getRun(s.run.id)).toMatchObject({ settled: '10000', held: '0' });
      expect(s.ledger.getRun(s.run.id).purchases[0]).toMatchObject({
        serviceOutcome: 'delivered',
        chainVerified: true,
      });
      await expect(
        readOnly.runPaidTool(s.run.id, 'readonly_recover01', 'wallet_snapshot', {
          address: s.payer,
        })
      ).rejects.toThrow(/transmission is disabled/);
    }
  );
  it('keeps observing after repeated RPC misses and exhausted transmission attempts without creating another charge', async () => {
    const s = await setup({ throwAfterSettlement: true });
    await expect(
      s.service.runPaidTool(s.run.id, 'repeated_reads_001', 'wallet_snapshot', { address: s.payer })
    ).rejects.toThrow();
    const find = vi.spyOn(s.rpc, 'findSettlement').mockResolvedValue(null);
    const fetcher = vi.fn<typeof fetch>();
    const observer = await createPaymentService({ ...s.config, enabled: false }, s.ledger, s.data, {
      ...s.adapters,
      fetch: fetcher,
    });
    for (let n = 0; n < 6; n++) {
      s.db.prepare('UPDATE buyer_replays SET checked_at=0').run();
      await observer.reconcile();
    }
    expect(find).toHaveBeenCalledTimes(6);
    expect(s.db.prepare('SELECT attempts FROM buyer_replays').get()).toEqual({ attempts: 0 });
    s.db.prepare('UPDATE buyer_replays SET attempts=4,checked_at=0').run();
    find.mockResolvedValue({
      signature,
      chainVerified: true,
      slot: 123,
      feeLamports: '10001',
      feeSponsor: s.sponsor,
    });
    await observer.reconcile();
    expect(s.ledger.getRun(s.run.id)).toMatchObject({ settled: '10000', held: '0' });
    expect(fetcher).not.toHaveBeenCalled();
    expect(s.sign).toHaveBeenCalledTimes(1);
    expect(s.settle).toHaveBeenCalledTimes(1);
  });
  it('checks cancellation immediately before signing, and rejects excessive fees and expired blockhashes', async () => {
    const s = await setup();
    const original = s.rpc.validateLifetimeAndFee.bind(s.rpc);
    vi.spyOn(s.rpc, 'validateLifetimeAndFee').mockImplementation(async (...args) => {
      await original(...args);
      s.ledger.stop(s.run.id);
    });
    await expect(
      s.service.runPaidTool(s.run.id, 'cancel_payment_001', 'wallet_snapshot', { address: s.payer })
    ).rejects.toThrow();
    expect(s.sign).not.toHaveBeenCalled();
    expect(s.ledger.getRun(s.run.id).held).toBe('0');
    const fee = await setup();
    fee.state.fee = 99999;
    await expect(
      fee.service.runPaidTool(fee.run.id, 'fee_payment_00001', 'wallet_snapshot', {
        address: fee.payer,
      })
    ).rejects.toThrow();
    expect(fee.sign).not.toHaveBeenCalled();
    const stale = await setup();
    stale.state.valid = false;
    await expect(
      stale.service.runPaidTool(stale.run.id, 'stale_payment_001', 'wallet_snapshot', {
        address: stale.payer,
      })
    ).rejects.toThrow();
    expect(stale.sign).not.toHaveBeenCalled();
  });
  it('rejects invalid arguments before a paid handler or signature and database outage denies signing', async () => {
    const s = await setup();
    const invalid = await fetch(`${s.origin}/merchant/transaction-explain`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-payment-id': 'invalid_args_0001' },
      body: JSON.stringify({ signature: 'bad' }),
    });
    expect(invalid.status).toBe(400);
    expect(s.sign).not.toHaveBeenCalled();
    expect(s.data.transactionExplain).not.toHaveBeenCalled();
    s.db.close();
    await expect(
      s.service.runPaidTool(s.run.id, 'db_failed_call_01', 'wallet_snapshot', { address: s.payer })
    ).rejects.toThrow();
    expect(s.sign).not.toHaveBeenCalled();
  });
  it('a rejected signer retains a conservative hold and invokes no facilitator settlement', async () => {
    const s = await setup();
    s.sign.mockRejectedValueOnce(Error('Controlled signer error.'));
    await expect(
      s.service.runPaidTool(s.run.id, 'signer_reject_001', 'wallet_snapshot', { address: s.payer })
    ).rejects.toThrow();
    expect(s.settle).not.toHaveBeenCalled();
    expect(s.ledger.getRun(s.run.id).held).toBe('10000');
    expect(s.ledger.payerFrozen()).toBe(true);
  });
  it('caps concurrent recovery atomically without creating signatures', async () => {
    const s = await setup({ throwAfterSettlement: true });
    await expect(
      s.service.runPaidTool(s.run.id, 'recovery_cap_0001', 'wallet_snapshot', { address: s.payer })
    ).rejects.toThrow();
    s.db.prepare('UPDATE buyer_replays SET attempts=3').run();
    const reads = vi.spyOn(s.rpc, 'findSettlement').mockResolvedValue(null);
    await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        s.service.runPaidTool(s.run.id, 'recovery_cap_0001', 'wallet_snapshot', {
          address: s.payer,
        })
      )
    );
    expect(reads).toHaveBeenCalledTimes(1);
    expect(s.db.prepare('SELECT attempts FROM buyer_replays').get()).toEqual({ attempts: 4 });
    expect(s.sign).toHaveBeenCalledTimes(1);
  });
});
describe('strict challenge and transaction guards', () => {
  it.each(['network', 'asset', 'payTo', 'amount', 'scheme'])(
    'rejects changed %s before signing',
    async (field) => {
      const expected = {
        network: PAYMENT_NETWORK,
        mint: USDC_MINT,
        url: 'https://merchant.test/merchant/wallet-snapshot',
        amount: '10000',
        recipient: 'recipient',
        sponsor: 'sponsor',
        memo: 'original-memo',
      };
      const requirements = {
        scheme: 'exact',
        network: PAYMENT_NETWORK,
        asset: USDC_MINT,
        payTo: 'recipient',
        amount: '10000',
        maxTimeoutSeconds: 60,
        extra: { feePayer: 'sponsor', memo: 'original-memo' },
      };
      const required = {
        x402Version: 2,
        resource: { url: expected.url },
        accepts: [{ ...requirements, [field]: 'changed' }],
        extensions: { 'payment-identifier': declarePaymentIdentifierExtension(true) },
      } as PaymentRequired;
      expect(() => validateRequirements(required, expected)).toThrow();
    }
  );
  it('rejects price changes, resource changes, extra instructions and an altered transfer amount in a real SDK payload', async () => {
    const s = await setup();
    await s.service.runPaidTool(s.run.id, 'strict_payload_01', 'wallet_snapshot', {
      address: s.payer,
    });
    const payload = s.lastPayload()!;
    const bytes = decodePaymentTransaction(payload).message;
    const expected = {
      network: PAYMENT_NETWORK,
      mint: USDC_MINT,
      payer: s.payer,
      sponsor: s.sponsor,
      recipient: s.recipient,
      amount: '10000',
      memo: paymentMemo(
        'strict_payload_01',
        canonicalRequest('wallet_snapshot', { address: s.payer }, s.origin).hash
      ),
    };
    await expect(validateTransaction(bytes, expected)).resolves.toMatchObject({
      source: expect.any(String),
    });
    await expect(validateTransaction(bytes, { ...expected, amount: '10001' })).rejects.toThrow(
      /exactly/
    );
    await expect(validateTransaction(Uint8Array.from([...bytes, 0]), expected)).rejects.toThrow(
      /trailing/
    );
    const corrupt = structuredClone(payload);
    const raw = Buffer.from(String(corrupt.payload.transaction), 'base64');
    raw[70] ^= 1;
    corrupt.payload.transaction = raw.toString('base64');
    expect(() => verifyPayerSignature(corrupt)).toThrow();
  });
  it('never treats maxTimeoutSeconds as an absolute challenge timestamp', () => {
    const expected = {
      network: PAYMENT_NETWORK,
      mint: USDC_MINT,
      url: 'https://merchant.test/merchant/wallet-snapshot',
      amount: '10000',
      recipient: 'recipient',
      sponsor: 'sponsor',
      memo: 'memo',
    };
    const requirements: PaymentRequirements = {
      scheme: 'exact',
      network: PAYMENT_NETWORK,
      asset: USDC_MINT,
      payTo: 'recipient',
      amount: '10000',
      maxTimeoutSeconds: 60,
      extra: { feePayer: 'sponsor', memo: 'memo' },
    };
    const required: PaymentRequired = {
      x402Version: 2,
      resource: { url: expected.url },
      accepts: [requirements],
      extensions: { 'payment-identifier': declarePaymentIdentifierExtension(true) },
    };
    expect(validateRequirements(required, expected).maxTimeoutSeconds).toBe(60);
    required.accepts[0].maxTimeoutSeconds = Date.now();
    expect(() => validateRequirements(required, expected)).toThrow(/timeout/);
  });
  it('closes signer scope when SDK construction times out, so a late callback cannot sign', async () => {
    let release: () => void = () => {};
    let entered: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const s = await setup({
      scheme: (signer, identity) => ({
        scheme: 'exact',
        findDefaultAsset: () => ({ asset: USDC_MINT, decimals: 6, symbol: 'USDC' }),
        createPaymentPayload: async (version, requirements) => {
          entered();
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          return new ExactSvmScheme(signer, {
            rpcUrl: `${new URL(identity.url).origin}/rpc`,
          }).createPaymentPayload(version, requirements);
        },
      }),
    });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const request = s.service.runPaidTool(s.run.id, 'timeout_scope_001', 'wallet_snapshot', {
      address: s.payer,
    });
    const rejection = expect(request).rejects.toThrow(/deadline/);
    await started;
    await vi.advanceTimersByTimeAsync(25_001);
    await rejection;
    vi.useRealTimers();
    release();
    await new Promise((resolve) => setTimeout(resolve, 75));
    expect(s.sign).not.toHaveBeenCalled();
    expect(s.ledger.getRun(s.run.id).held).toBe('0');
  });
});

describe('mainnet exact payment boundaries with controlled adapters', () => {
  it('uses mainnet challenge, native mint, immutable policy and SDK transfer without claiming a live settlement', async () => {
    const s = await setup({ network: 'mainnet' });
    await s.service.runPaidTool(s.run.id, 'mainnet_fixture_0001', 'wallet_snapshot', {
      address: s.payer,
    });
    const run = s.ledger.getRun(s.run.id);
    expect(run).toMatchObject({
      paymentNetwork: 'mainnet',
      settled: '10000',
      policy: { network: PAYMENT_CHAINS.mainnet.network, mint: PAYMENT_CHAINS.mainnet.mint },
    });
    expect(s.lastPayload()?.accepted).toMatchObject({
      network: PAYMENT_CHAINS.mainnet.network,
      asset: PAYMENT_CHAINS.mainnet.mint,
    });
    expect(decodePaymentTransaction(s.lastPayload()!).decoded.keys).toContain(
      PAYMENT_CHAINS.mainnet.mint
    );
    expect(run.purchases[0].chainVerified).toBe(false);
  });
  it.each([{ rpcNetwork: 'devnet' as const }, { facilitatorNetwork: 'devnet' as const }])(
    'rejects mismatched readiness before signing (%o)',
    async (wrong) => {
      const s = await setup({ network: 'mainnet', ...wrong });
      expect((await s.service.readiness()).ready).toBe(false);
      await expect(
        s.service.runPaidTool(s.run.id, 'wrong_network_0001', 'wallet_snapshot', {
          address: s.payer,
        })
      ).rejects.toThrow(/unavailable/);
      expect(s.sign).not.toHaveBeenCalled();
      expect(s.settle).not.toHaveBeenCalled();
    }
  );
  it('rejects RPC cluster changes after preflight, before the payer signature', async () => {
    const s = await setup({ network: 'mainnet' });
    expect((await s.service.readiness()).ready).toBe(true);
    s.state.genesisHash = PAYMENT_CHAINS.devnet.genesisHash;
    await expect(
      s.service.runPaidTool(s.run.id, 'changed_rpc_00001', 'wallet_snapshot', { address: s.payer })
    ).rejects.toThrow(/not Solana mainnet/);
    expect(s.sign).not.toHaveBeenCalled();
  });
  it('rejects a devnet challenge under a mainnet authorization', () => {
    const expected = {
      network: PAYMENT_CHAINS.mainnet.network,
      mint: PAYMENT_CHAINS.mainnet.mint,
      url: 'https://merchant.test/merchant/wallet-snapshot',
      amount: '10000',
      recipient: 'recipient',
      sponsor: 'sponsor',
      memo: 'memo',
    };
    const required: PaymentRequired = {
      x402Version: 2,
      resource: { url: expected.url },
      accepts: [
        {
          scheme: 'exact',
          network: PAYMENT_CHAINS.devnet.network,
          asset: PAYMENT_CHAINS.devnet.mint,
          amount: expected.amount,
          payTo: expected.recipient,
          maxTimeoutSeconds: 60,
          extra: { feePayer: expected.sponsor, memo: expected.memo },
        },
      ],
      extensions: { 'payment-identifier': declarePaymentIdentifierExtension(true) },
    };
    expect(() => validateRequirements(required, expected)).toThrow(/approved catalog/);
  });
  it('preserves an uncertain devnet hold and refuses to replay it through a mainnet runtime', async () => {
    const s = await setup({ throwAfterSettlement: true });
    await expect(
      s.service.runPaidTool(s.run.id, 'devnet_old_hold_01', 'wallet_snapshot', { address: s.payer })
    ).rejects.toThrow();
    const networkFetch = vi.fn<typeof fetch>();
    const changed = await createPaymentService(
      { ...s.config, network: 'mainnet' },
      s.ledger,
      s.data,
      { ...s.adapters, rpc: new PaymentRpc(`${s.origin}/rpc`, 'mainnet'), fetch: networkFetch }
    );
    await changed.reconcile();
    await expect(
      changed.runPaidTool(s.run.id, 'devnet_old_hold_01', 'wallet_snapshot', { address: s.payer })
    ).rejects.toThrow(/original network/);
    expect(networkFetch).not.toHaveBeenCalled();
    expect(s.sign).toHaveBeenCalledTimes(1);
    expect(s.ledger.getRun(s.run.id)).toMatchObject({
      paymentNetwork: 'devnet',
      held: '10000',
      settled: '0',
    });
    expect(s.db.prepare('SELECT attempts FROM buyer_replays').get()).toEqual({ attempts: 0 });
  });
  it('rejects independent chain proof using a payload from another network before fetching a transaction', async () => {
    const s = await setup();
    await s.service.runPaidTool(s.run.id, 'devnet_proof_0001', 'wallet_snapshot', {
      address: s.payer,
    });
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      async (_input, init) =>
        new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: JSON.parse(String(init?.body)).id,
            result: PAYMENT_CHAINS.mainnet.genesisHash,
          })
        )
    );
    const mainnetRpc = new PaymentRpc('https://rpc.example', 'mainnet', fetcher);
    await expect(
      mainnetRpc.evidence(signature, s.lastPayload()!, '10000', s.recipient)
    ).rejects.toThrow(/network/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

it('verifies exact mainnet token deltas and transaction identity using a controlled RPC fixture', async () => {
  const s = await setup({ network: 'mainnet' });
  await s.service.runPaidTool(s.run.id, 'mainnet_rpc_proof01', 'wallet_snapshot', {
    address: s.payer,
  });
  const payload = s.lastPayload()!;
  const decoded = decodePaymentTransaction(payload);
  const accounts = await expectedAccounts(s.payer, s.recipient, PAYMENT_CHAINS.mainnet.mint);
  const landed = Buffer.from(String(payload.payload.transaction), 'base64');
  landed.fill(31, 1, 65); // Controlled sponsor signature matches the RPC query identity.
  const balance = (account: string, owner: string, amount: string) => ({
    accountIndex: decoded.decoded.keys.indexOf(account),
    owner,
    mint: PAYMENT_CHAINS.mainnet.mint,
    uiTokenAmount: { amount, decimals: 6 },
  });
  const transaction = {
    slot: 100,
    transaction: [landed.toString('base64'), 'base64'],
    meta: {
      err: null,
      fee: 10001,
      preTokenBalances: [
        balance(accounts.source, s.payer, '20000'),
        balance(accounts.destination, s.recipient, '10000'),
      ],
      postTokenBalances: [
        balance(accounts.source, s.payer, '10000'),
        balance(accounts.destination, s.recipient, '20000'),
      ],
    },
  };
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_input, init) => {
    const { method, id } = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        id,
        result: method === 'getGenesisHash' ? PAYMENT_CHAINS.mainnet.genesisHash : transaction,
      })
    );
  });
  const rpc = new PaymentRpc('https://controlled-rpc.example', 'mainnet', fetcher);
  await expect(rpc.evidence(signature, payload, '10000', s.recipient)).resolves.toMatchObject({
    chainVerified: true,
    signature,
    feeLamports: '10001',
  });
  transaction.meta.postTokenBalances[1].uiTokenAmount.amount = '19999';
  await expect(rpc.evidence(signature, payload, '10000', s.recipient)).resolves.toBeNull();
  transaction.meta.postTokenBalances[1].uiTokenAmount.amount = '20000';
  await expect(rpc.evidence(otherSignature, payload, '10000', s.recipient)).resolves.toBeNull();
  const originalEncoding = transaction.transaction[0];
  const alteredSignature = Buffer.from(originalEncoding, 'base64');
  alteredSignature[80] ^= 1;
  transaction.transaction[0] = alteredSignature.toString('base64');
  await expect(rpc.evidence(signature, payload, '10000', s.recipient)).resolves.toBeNull();
  transaction.transaction[0] = originalEncoding;
  transaction.meta.fee = 15001;
  await expect(rpc.evidence(signature, payload, '10000', s.recipient)).resolves.toBeNull();
});

it.each([
  { jsonrpc: '2.0', id: 999, result: null },
  { jsonrpc: '1.0', id: 1, result: null },
  { jsonrpc: '2.0', id: 1, result: null, error: null },
])('rejects malformed payment RPC envelopes: %o', async (envelope) => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(envelope)));
  const rpc = new PaymentRpc('https://rpc.example', 'mainnet', fetcher);
  await expect(rpc.call('getTransaction', [])).rejects.toThrow();
});

it('reconciles mainnet despite more than one batch of unreconciled historical devnet rows', async () => {
  const s = await setup({ network: 'mainnet', throwAfterSettlement: true });
  await expect(
    s.service.runPaidTool(s.run.id, 'mainnet_recovery01', 'wallet_snapshot', { address: s.payer })
  ).rejects.toThrow();
  // Retained historical rows must be filtered before the bounded 20-purchase batch.
  const original = s.db.prepare('SELECT * FROM buyer_replays').get() as Record<string, unknown>;
  const historicalTerms = {
    ...JSON.parse(String(original.requirements_json)),
    network: PAYMENT_CHAINS.devnet.network,
    asset: PAYMENT_CHAINS.devnet.mint,
  };
  for (let index = 0; index < 25; index++) {
    const row = {
      ...original,
      intent_id: `aaa_devnet_${index}`,
      request_id: `aaa_devnet_${index}`,
      requirements_json: JSON.stringify(historicalTerms),
    };
    s.db
      .prepare(
        `INSERT INTO buyer_replays (${Object.keys(row).join(',')}) VALUES (${Object.keys(row)
          .map(() => '?')
          .join(',')})`
      )
      .run(...Object.values(row));
  }
  vi.spyOn(s.rpc, 'findSettlement').mockResolvedValue({
    signature,
    chainVerified: true,
    slot: 123,
    feeLamports: '10001',
    feeSponsor: s.sponsor,
  });
  await s.service.reconcile();
  expect(s.ledger.getRun(s.run.id)).toMatchObject({ settled: '10000', held: '0' });
  expect(s.sign).toHaveBeenCalledTimes(1);
  expect(
    s.db
      .prepare(
        "SELECT SUM(attempts) AS attempts FROM buyer_replays WHERE intent_id LIKE 'aaa_devnet_%'"
      )
      .get()
  ).toEqual({ attempts: 0 });
});
