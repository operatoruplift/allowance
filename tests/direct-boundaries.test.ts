import { afterEach, describe, expect, it, vi } from 'vitest';
import { address, generateKeyPairSigner } from '@solana/kit';
import { TOKEN_PROGRAM_ADDRESS, findAssociatedTokenPda } from '@solana-program/token';
import { PAYMENT_CHAINS } from '../shared/domain.js';
import { loadConfig } from '../server/config.js';
import { openDatabase } from '../server/db/index.js';
import { MandateLedger } from '../server/direct/ledger.js';
import { createDirectPaymentService } from '../server/direct/service.js';
import { createMandateGrant, revokeSessionMandateGrants } from '../server/direct/grants.js';
import { Ledger } from '../server/policy/ledger.js';
import { acquireServiceLease } from '../server/db/lease.js';
import { FakeChain } from './fixtures/direct-chain.js';

const dbs: ReturnType<typeof openDatabase>[] = [];
afterEach(() => dbs.splice(0).forEach((db) => db.open && db.close()));

async function setup() {
  const key = await generateKeyPairSigner();
  const signTransactions = vi.fn(async () => {
    throw new Error('These boundary tests must never sign.');
  });
  const signer = { ...key, signTransactions };
  const vendor = await generateKeyPairSigner();
  const chain = new FakeChain();
  const [source] = await findAssociatedTokenPda({
    owner: signer.address,
    mint: address(PAYMENT_CHAINS.devnet.mint),
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });
  chain.fund(source, signer.address, 1_000_000n);
  chain.lamports.set(signer.address, 50_000_000n);
  const config = loadConfig({
    PAYMENT_NETWORK: 'devnet',
    PAYMENT_RPC_URL: 'https://api.devnet.solana.com',
    DIRECT_PAYMENTS_ENABLED: 'true',
  });
  const db = openDatabase(':memory:');
  dbs.push(db);
  const ledger = new Ledger(db, config);
  const mandates = new MandateLedger(db, config, ledger);
  const mandate = mandates.create(
    {
      label: 'Boundary checks',
      perRequestCap: '0.010000',
      ceiling: '0.020000',
      expiresInMinutes: 5,
      recipients: [{ address: vendor.address, label: 'Vendor' }],
    },
    signer.address
  );
  const direct = await createDirectPaymentService(
    config,
    { ledger, mandates },
    { rpc: chain, signer }
  );
  const request = {
    requestId: 'boundary_request_0001',
    recipient: vendor.address,
    amount: '0.010000',
  };
  const claim = {
    messageHash: 'unsigned-boundary-test',
    blockhash: chain.blockhash,
    lastValidBlockHeight: '10',
    payer: signer.address,
    source,
    destination: 'unsigned-boundary-test',
    createRecipientAccount: false,
  };
  function pendingPayment() {
    const { payment } = mandates.reserve(mandate.id, request, 'operator');
    mandates.markSigning(payment.id, claim);
    // Stored metadata only: no private-key operation or network submission occurs.
    mandates.markSigned(payment.id, {
      signature: 'unsigned-boundary-test',
      wire: 'unsigned-boundary-test',
    });
    mandates.markSubmitted(payment.id);
    return payment.id;
  }
  return {
    config,
    db,
    ledger,
    mandates,
    mandate,
    direct,
    chain,
    signer,
    signTransactions,
    request,
    claim,
    pendingPayment,
  };
}

describe('direct payment authorization boundaries', () => {
  it('rejects a signing claim for a payer other than the one frozen in the mandate', async () => {
    const { mandates, mandate, request, claim, db } = await setup();
    const { payment } = mandates.reserve(mandate.id, request, 'operator');
    expect(() => mandates.markSigning(payment.id, { ...claim, payer: request.recipient })).toThrow(
      /payer.*mandate/i
    );
    expect(
      db.prepare('SELECT signed_identity FROM direct_payments WHERE id=?').get(payment.id)
    ).toEqual({ signed_identity: null });
  });

  it('retains the payment hold when the recovery RPC fails genesis verification', async () => {
    const { direct, chain, pendingPayment, mandates, ledger } = await setup();
    const id = pendingPayment();
    chain.assertNetwork = vi.fn(async () => {
      throw new Error('Wrong genesis hash');
    });
    await expect(direct.reconcile()).rejects.toThrow(/genesis/);
    expect(chain.assertNetwork).toHaveBeenCalledOnce();
    expect(chain.methods('getSignatureStatuses')).toHaveLength(0);
    expect(mandates.getPayment(id)?.status).toBe('submitted');
    expect(ledger.payerFrozen()).toBe(true);
  });

  it('does not reconcile a devnet payment with a mainnet runtime', async () => {
    const { config, ledger, mandates, signer, pendingPayment } = await setup();
    const id = pendingPayment();
    const call = vi.fn(async () => ({ value: [null] }));
    const direct = await createDirectPaymentService(
      { ...config, paymentNetwork: 'mainnet' },
      { ledger, mandates },
      { signer, rpc: { network: 'mainnet', assertNetwork: async () => {}, call } }
    );
    await direct.reconcile();
    expect(call).not.toHaveBeenCalled();
    expect(mandates.getPayment(id)?.status).toBe('submitted');
    expect(ledger.payerFrozen()).toBe(true);
  });

  it('releases an unsigned reservation if its grant is revoked during pre-sign checks', async () => {
    const { db, mandates, mandate, direct, chain, signTransactions, request, ledger } =
      await setup();
    db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(
      'boundary-session',
      Date.now() + 3600000,
      JSON.stringify({ operator: 'operator', issuedAt: Date.now() })
    );
    createMandateGrant(db, mandates, {
      mandateId: mandate.id,
      owner: 'operator',
      sessionId: 'boundary-session',
      expiresAt: mandate.policy.expiresAt,
    });
    const original = chain.call.bind(chain);
    chain.call = async (method, params) => {
      if (method === 'simulateTransaction') revokeSessionMandateGrants(db, 'boundary-session');
      return original(method, params);
    };
    await expect(direct.pay(mandate.id, request, 'external-agent')).rejects.toThrow(
      /active human authorization/
    );
    expect(mandates.getPayment(request.requestId)?.status).toBe('released');
    expect(ledger.dailyUsed()).toBe(0);
    expect(signTransactions).not.toHaveBeenCalled();
    expect(chain.methods('sendTransaction')).toHaveLength(0);
  });

  it.each([
    ['simulation result without an explicit error field', 'simulateTransaction', { value: {} }],
    ['negative network fee', 'getFeeForMessage', { value: -1 }],
  ])('rejects a %s before signing', async (_label, rpcMethod, response) => {
    const { direct, chain, mandate, mandates, request, signTransactions, ledger } = await setup();
    const original = chain.call.bind(chain);
    chain.call = (method, params) =>
      method === rpcMethod ? Promise.resolve(response) : original(method, params);
    await expect(direct.pay(mandate.id, request, 'operator')).rejects.toThrow();
    expect(mandates.getPayment(request.requestId)?.status).toBe('released');
    expect(ledger.dailyUsed()).toBe(0);
    expect(signTransactions).not.toHaveBeenCalled();
    expect(chain.methods('sendTransaction')).toHaveLength(0);
  });

  it('releases an unsigned reservation when transaction composition rejects a malformed blockhash', async () => {
    const { direct, chain, mandate, mandates, request, signTransactions, ledger } = await setup();
    chain.blockhash = '0'.repeat(32);
    await expect(direct.pay(mandate.id, request, 'operator')).rejects.toThrow();
    expect(mandates.getPayment(request.requestId)?.status).toBe('released');
    expect(ledger.dailyUsed()).toBe(0);
    expect(signTransactions).not.toHaveBeenCalled();
    expect(chain.methods('sendTransaction')).toHaveLength(0);
  });

  it.each(['restored journal', 'expired lease', 'replaced lease'] as const)(
    'keeps signed holds and observes expiry without broadcasting from a %s',
    async (boundary) => {
      const { config, db, ledger, mandates, chain, signer, signTransactions, pendingPayment } =
        await setup();
      const id = pendingPayment();
      mandates.markUnknown(id, 'Stored original awaiting recovery.');
      const originalIdentity = db
        .prepare('SELECT signed_identity FROM direct_payments WHERE id=?')
        .get(id);
      let clock = Date.now();
      const lease = acquireServiceLease(db, () => clock);
      const guarded = new MandateLedger(db, config, ledger, Date.now, lease.assert);
      const direct = await createDirectPaymentService(
        config,
        { ledger, mandates: guarded },
        { rpc: chain, signer }
      );
      if (boundary === 'restored journal') {
        db.prepare(
          'INSERT INTO restore_recoveries(id,backup_id,backup_completed_at,restored_at) VALUES(?,?,?,?)'
        ).run(
          'boundary-restore',
          'boundary-backup',
          new Date().toISOString(),
          new Date().toISOString()
        );
      } else {
        clock += 20001;
        if (boundary === 'replaced lease') acquireServiceLease(db, () => clock);
      }
      chain.blockHeight = 1n;
      await direct.reconcile();
      expect(chain.methods('sendTransaction')).toHaveLength(0);
      expect(chain.methods('getSignatureStatuses').length).toBeGreaterThan(0);
      expect(mandates.getPayment(id)?.status).toBe('settlement-unknown');
      expect(ledger.payerFrozen()).toBe(true);
      expect(db.prepare('SELECT signed_identity FROM direct_payments WHERE id=?').get(id)).toEqual(
        originalIdentity
      );
      chain.blockHeight = 20n;
      await direct.reconcile();
      expect(chain.methods('sendTransaction')).toHaveLength(0);
      expect(mandates.getPayment(id)?.status).toBe('expired');
      expect(ledger.payerFrozen()).toBe(false);
      expect(signTransactions).not.toHaveBeenCalled();
    }
  );

  it('rechecks ownership after recovery RPC calls and still observes if the lease expired', async () => {
    const { config, db, ledger, mandates, chain, signer, pendingPayment } = await setup();
    const id = pendingPayment();
    mandates.markUnknown(id, 'Stored original awaiting recovery.');
    let clock = Date.now();
    const lease = acquireServiceLease(db, () => clock);
    const guarded = new MandateLedger(db, config, ledger, Date.now, lease.assert);
    const direct = await createDirectPaymentService(
      config,
      { ledger, mandates: guarded },
      { rpc: chain, signer }
    );
    const original = chain.call.bind(chain);
    chain.call = async (method, params) => {
      if (method === 'isBlockhashValid') clock += 20001;
      return original(method, params);
    };
    chain.blockHeight = 20n;
    await direct.reconcile();
    expect(chain.methods('isBlockhashValid')).toHaveLength(1);
    expect(chain.methods('sendTransaction')).toHaveLength(0);
    expect(mandates.getPayment(id)?.status).toBe('expired');
    expect(ledger.payerFrozen()).toBe(false);
  });

  it('can observe original payment expiry while direct payments are disabled and no signer is loaded', async () => {
    const { config, ledger, mandates, chain, pendingPayment } = await setup();
    const id = pendingPayment();
    mandates.markUnknown(id, 'Stored original awaiting recovery.');
    chain.blockHeight = 20n;
    const direct = await createDirectPaymentService(
      { ...config, directEnabled: false },
      { ledger, mandates },
      { rpc: chain }
    );
    expect(direct.payer).toBeNull();
    await direct.reconcile();
    expect(chain.methods('sendTransaction')).toHaveLength(0);
    expect(mandates.getPayment(id)?.status).toBe('expired');
    expect(ledger.payerFrozen()).toBe(false);
  });
});
