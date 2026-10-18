import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  generateKeyPair,
  generateKeyPairSigner,
  getAddressFromPublicKey,
  getBase58Decoder,
  getUtf8Encoder,
  signBytes,
  type KeyPairSigner,
} from '@solana/kit';
import { TOKEN_PROGRAM_ADDRESS, findAssociatedTokenPda } from '@solana-program/token';
import { PAYMENT_CHAINS } from '../shared/domain.js';
import { approvalMessage, recipientApprovalSchema } from '../shared/mandate.js';
import { loadConfig } from '../server/config.js';
import { openDatabase } from '../server/db/index.js';
import { Ledger } from '../server/policy/ledger.js';
import { MandateLedger } from '../server/direct/ledger.js';
import { createDirectPaymentService } from '../server/direct/service.js';
import { readTransferPreconditions } from '../server/direct/transfer.js';
import { verifyRecipientApproval } from '../server/direct/approval.js';
import {
  SYSTEM_PROGRAM_ADDRESS,
  TOKEN_2022_PROGRAM_ADDRESS,
  assertRecipientAccount,
  classifyRecipientAccount,
  type RecipientAccountKind,
} from '../server/direct/recipient.js';
import { PaymentError } from '../server/payments/guard.js';
import { FakeChain } from './fixtures/direct-chain.js';

const MINT = PAYMENT_CHAINS.devnet.mint;
const dbs: ReturnType<typeof openDatabase>[] = [];
afterEach(() => dbs.splice(0).forEach((db) => db.open && db.close()));
const ata = async (owner: string) =>
  String(
    (
      await findAssociatedTokenPda({
        owner: owner as never,
        mint: MINT as never,
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
      })
    )[0]
  );

/** `getAccountInfo` values with `jsonParsed` encoding, shaped as a devnet node returns them. */
const tokenAccount = (owner: string, program = TOKEN_PROGRAM_ADDRESS as string) => ({
  owner: program,
  executable: false,
  lamports: 2_039_280,
  rentEpoch: 0,
  space: 165,
  data: {
    program: program === TOKEN_PROGRAM_ADDRESS ? 'spl-token' : 'spl-token-2022',
    space: 165,
    parsed: {
      type: 'account',
      info: {
        mint: MINT,
        owner,
        state: 'initialized',
        isNative: false,
        tokenAmount: { amount: '0', decimals: 6, uiAmount: 0, uiAmountString: '0' },
      },
    },
  },
});
const fixtures = {
  wallet: {
    owner: SYSTEM_PROGRAM_ADDRESS,
    executable: false,
    lamports: 1_500_000,
    rentEpoch: 0,
    space: 0,
    data: ['', 'base64'],
  },
  'token-account': tokenAccount('5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1'),
  'token-2022-account': tokenAccount(
    '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1',
    TOKEN_2022_PROGRAM_ADDRESS
  ),
  mint: {
    owner: TOKEN_PROGRAM_ADDRESS,
    executable: false,
    lamports: 1_461_600,
    rentEpoch: 0,
    space: 82,
    data: {
      program: 'spl-token',
      space: 82,
      parsed: {
        type: 'mint',
        info: { decimals: 6, isInitialized: true, supply: '1000000', mintAuthority: null, freezeAuthority: null },
      },
    },
  },
  program: {
    owner: 'BPFLoaderUpgradeab1e11111111111111111111111',
    executable: true,
    lamports: 1_141_440,
    rentEpoch: 0,
    space: 36,
    data: {
      program: 'bpf-upgradeable-loader',
      space: 36,
      parsed: { type: 'program', info: { programData: 'ProgramData11111111111111111111111111111111' } },
    },
  },
  'program-owned': {
    owner: 'SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf',
    executable: false,
    lamports: 2_000_000,
    rentEpoch: 0,
    space: 8,
    data: ['AAAAAAAAAAA=', 'base64'],
  },
} as const;
const refusals: [keyof typeof fixtures, RegExp][] = [
  ['token-account', /wallet address, not a token account/],
  ['token-2022-account', /wallet address, not a token account/],
  ['mint', /token mint, not a wallet address/],
  ['program', /executable program, not a wallet address/],
  ['program-owned', /program-owned account/],
];

describe('recipient account classification', () => {
  it.each<[keyof typeof fixtures, RecipientAccountKind]>([
    ['wallet', 'wallet'],
    ['token-account', 'token-account'],
    ['token-2022-account', 'token-account'],
    ['mint', 'mint'],
    ['program', 'program'],
    ['program-owned', 'program-owned'],
  ])('reads a %s account as %s', (fixture, kind) => {
    expect(classifyRecipientAccount(fixtures[fixture])).toBe(kind);
  });
  it('treats an address without an account as absent and fails closed on an unreadable one', () => {
    expect(classifyRecipientAccount(null)).toBe('absent');
    expect(() => classifyRecipientAccount({ owner: SYSTEM_PROGRAM_ADDRESS })).toThrow();
  });
  it('accepts only a wallet or an unused address unless a program-owned account was opted in', () => {
    expect(() => assertRecipientAccount('absent', false)).not.toThrow();
    expect(() => assertRecipientAccount('wallet', false)).not.toThrow();
    for (const kind of ['token-account', 'mint', 'program'] as const) {
      expect(() => assertRecipientAccount(kind, true)).toThrow(PaymentError);
      expect(() => assertRecipientAccount(kind, false)).toThrow(
        expect.objectContaining({ code: 'recipient-account' })
      );
    }
    expect(() => assertRecipientAccount('program-owned', false)).toThrow(/allowProgramOwnedRecipient/);
    expect(() => assertRecipientAccount('program-owned', true)).not.toThrow();
  });
});

async function fundedChain() {
  const payer = await generateKeyPairSigner();
  const recipient = await generateKeyPairSigner();
  const chain = new FakeChain();
  chain.fund(await ata(payer.address), payer.address, 5_000_000n);
  chain.lamports.set(payer.address, 50_000_000n);
  return { payer, recipient, chain };
}

describe('transfer preconditions', () => {
  it.each(refusals)('refuse a %s pasted as the recipient', async (fixture, message) => {
    const { payer, recipient, chain } = await fundedChain();
    chain.accounts.set(recipient.address, fixtures[fixture]);
    await expect(
      readTransferPreconditions(chain, payer.address, recipient.address, MINT)
    ).rejects.toMatchObject({ code: 'recipient-account', message });
  });
  it('accept a wallet and an address that has no account yet', async () => {
    const { payer, recipient, chain } = await fundedChain();
    await expect(
      readTransferPreconditions(chain, payer.address, recipient.address, MINT)
    ).resolves.toMatchObject({ recipientAccountExists: false });
    chain.accounts.set(recipient.address, fixtures.wallet);
    await expect(
      readTransferPreconditions(chain, payer.address, recipient.address, MINT)
    ).resolves.toMatchObject({ recipientAccountExists: false });
  });
  it('accept a program-owned recipient only when the approval allowed it', async () => {
    const { payer, recipient, chain } = await fundedChain();
    chain.accounts.set(recipient.address, fixtures['program-owned']);
    await expect(
      readTransferPreconditions(chain, payer.address, recipient.address, MINT, {
        allowProgramOwnedRecipient: false,
      })
    ).rejects.toMatchObject({ code: 'recipient-account' });
    await expect(
      readTransferPreconditions(chain, payer.address, recipient.address, MINT, {
        allowProgramOwnedRecipient: true,
      })
    ).resolves.toMatchObject({ destination: await ata(recipient.address) });
    // The opt-in never widens to the other kinds.
    chain.accounts.set(recipient.address, fixtures['token-account']);
    await expect(
      readTransferPreconditions(chain, payer.address, recipient.address, MINT, {
        allowProgramOwnedRecipient: true,
      })
    ).rejects.toMatchObject({ code: 'recipient-account' });
  });
});

async function service(options: { recipients: { address: string; label: string }[]; admin?: string; signs?: boolean }) {
  const { payer, chain } = await fundedChain();
  const signTransactions = vi.fn(async () => {
    throw new Error('This payment must never be signed.');
  });
  const signer: KeyPairSigner = options.signs ? payer : { ...payer, signTransactions };
  const db = openDatabase(':memory:');
  dbs.push(db);
  const config = loadConfig({
    PAYMENT_NETWORK: 'devnet',
    PAYMENT_RPC_URL: 'https://api.devnet.solana.com',
    DIRECT_PAYMENTS_ENABLED: 'true',
    DAILY_USDC_CEILING: '1000.000000',
    MERCHANT_RECIPIENT: '11111111111111111111111111111111',
    ...(options.admin ? { ADMIN_PUBLIC_KEY: options.admin } : {}),
  });
  const ledger = new Ledger(db, config);
  const mandates = new MandateLedger(db, config, ledger);
  const direct = await createDirectPaymentService(
    config,
    { ledger, mandates },
    { rpc: chain, signer, sleep: async () => {}, confirmTimeoutMs: 5_000 }
  );
  const mandate = mandates.create(
    { label: 'Vendors', perRequestCap: '0.250000', ceiling: '1.000000', expiresInMinutes: 60, recipients: options.recipients },
    payer.address
  );
  return { payer, chain, db, ledger, mandates, direct, mandate, signTransactions };
}
const request = (recipient: string, requestId = `req_${randomBytes(8).toString('hex')}`) => ({
  requestId,
  recipient,
  amount: '0.010000',
});

describe('direct payments to an address that is not a wallet', () => {
  it('release the reservation and sign nothing when the allowlisted recipient is a token account', async () => {
    const vendor = await generateKeyPairSigner();
    const vendorAccount = await ata(vendor.address);
    const s = await service({ recipients: [{ address: vendorAccount, label: 'Pasted token account' }] });
    s.chain.fund(vendorAccount, vendor.address, 0n);
    const attempt = request(vendorAccount, 'token_account_request_01');
    await expect(s.direct.pay(s.mandate.id, attempt, 'operator')).rejects.toMatchObject({
      code: 'recipient-account',
      intentId: attempt.requestId,
    });
    expect(s.mandates.getPayment(attempt.requestId)).toMatchObject({
      status: 'released',
      reason: expect.stringMatching(/wallet address, not a token account/),
    });
    expect(s.signTransactions).not.toHaveBeenCalled();
    expect(s.chain.methods('simulateTransaction')).toHaveLength(0);
    expect(s.chain.methods('sendTransaction')).toHaveLength(0);
    expect(s.ledger.dailyUsed()).toBe(0);
    expect(s.mandates.get(s.mandate.id).remaining).toBe('1000000');
  });
  it('refuse the USDC mint pasted as the recipient', async () => {
    const s = await service({ recipients: [{ address: MINT, label: 'Mint' }] });
    s.chain.accounts.set(MINT, fixtures.mint);
    const attempt = request(MINT);
    await expect(s.direct.pay(s.mandate.id, attempt, 'operator')).rejects.toMatchObject({
      code: 'recipient-account',
      message: expect.stringMatching(/token mint/),
    });
    expect(s.mandates.getPayment(attempt.requestId)?.status).toBe('released');
    expect(s.signTransactions).not.toHaveBeenCalled();
  });
  it('refuse a program-owned recipient the operator listed without an administrator opt-in', async () => {
    const vault = await generateKeyPairSigner();
    const s = await service({ recipients: [{ address: vault.address, label: 'Vault' }] });
    s.chain.accounts.set(vault.address, fixtures['program-owned']);
    expect(s.mandates.recipientAllowsProgramOwned(s.mandate.id, vault.address)).toBe(false);
    const attempt = request(vault.address);
    await expect(s.direct.pay(s.mandate.id, attempt, 'operator')).rejects.toMatchObject({
      code: 'recipient-account',
      message: expect.stringMatching(/program-owned/),
    });
    expect(s.mandates.getPayment(attempt.requestId)?.status).toBe('released');
    expect(s.signTransactions).not.toHaveBeenCalled();
  });
});

describe('administrator approval of a program-owned recipient', () => {
  async function admin() {
    const key = await generateKeyPair();
    const address = await getAddressFromPublicKey(key.publicKey);
    const approve = async (
      mandateId: string,
      recipient: string,
      label: string,
      allowProgramOwnedRecipient?: boolean
    ) => {
      const nonce = `nonce_${randomBytes(8).toString('hex')}`;
      const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
      const message = approvalMessage({
        mandateId,
        address: recipient,
        label,
        nonce,
        expiresAt,
        ...(allowProgramOwnedRecipient === undefined ? {} : { allowProgramOwnedRecipient }),
      });
      const signature = getBase58Decoder().decode(
        await signBytes(key.privateKey, getUtf8Encoder().encode(message))
      );
      return recipientApprovalSchema.parse({
        address: recipient,
        label,
        nonce,
        expiresAt,
        signer: address,
        signature,
        ...(allowProgramOwnedRecipient === undefined ? {} : { allowProgramOwnedRecipient }),
      });
    };
    return { address, approve };
  }
  it('binds the flag into the signed text, stores it with the recipient and lets that payment settle', async () => {
    const vendor = await generateKeyPairSigner();
    const vault = await generateKeyPairSigner();
    const { address: adminAddress, approve } = await admin();
    const s = await service({ recipients: [{ address: vendor.address, label: 'Vendor' }], admin: adminAddress, signs: true });
    s.chain.accounts.set(vault.address, fixtures['program-owned']);
    const flagged = await approve(s.mandate.id, vault.address, 'Treasury vault', true);
    // Stripping the flag, or adding it to an approval signed without it, breaks the signature.
    await expect(
      verifyRecipientApproval(s.mandate.id, { ...flagged, allowProgramOwnedRecipient: false }, adminAddress)
    ).rejects.toMatchObject({ code: 'bad-signature' });
    const plain = await approve(s.mandate.id, vault.address, 'Treasury vault');
    await expect(
      verifyRecipientApproval(s.mandate.id, { ...plain, allowProgramOwnedRecipient: true }, adminAddress)
    ).rejects.toMatchObject({ code: 'bad-signature' });
    await expect(verifyRecipientApproval(s.mandate.id, flagged, adminAddress)).resolves.toBeUndefined();
    const mandate = s.mandates.addRecipient(s.mandate.id, flagged);
    expect(mandate.recipients[1]).toMatchObject({
      address: vault.address,
      addedBy: 'admin-signature',
      approvedBy: adminAddress,
      allowProgramOwnedRecipient: true,
    });
    expect(mandate.recipients[0]).not.toHaveProperty('allowProgramOwnedRecipient');
    expect(s.mandates.recipientAllowsProgramOwned(s.mandate.id, vault.address)).toBe(true);
    expect(mandate.events.at(-1)?.detail).toMatch(/program-owned account may be paid/);
    const payment = await s.direct.pay(s.mandate.id, request(vault.address), 'operator');
    expect(payment).toMatchObject({ status: 'settled', chainVerified: true, createdRecipientAccount: true });
    expect(s.chain.tokenAccounts.get(await ata(vault.address))).toMatchObject({ owner: vault.address, amount: 10_000n });
  });
  it('keeps a recipient approved without the flag on the wallet-only rule', async () => {
    const vendor = await generateKeyPairSigner();
    const vault = await generateKeyPairSigner();
    const { address: adminAddress, approve } = await admin();
    const s = await service({ recipients: [{ address: vendor.address, label: 'Vendor' }], admin: adminAddress });
    s.chain.accounts.set(vault.address, fixtures['program-owned']);
    const plain = await approve(s.mandate.id, vault.address, 'Vault without opt-in');
    await verifyRecipientApproval(s.mandate.id, plain, adminAddress);
    s.mandates.addRecipient(s.mandate.id, plain);
    expect(s.mandates.recipientAllowsProgramOwned(s.mandate.id, vault.address)).toBe(false);
    const attempt = request(vault.address);
    await expect(s.direct.pay(s.mandate.id, attempt, 'operator')).rejects.toMatchObject({ code: 'recipient-account' });
    expect(s.mandates.getPayment(attempt.requestId)?.status).toBe('released');
    expect(s.signTransactions).not.toHaveBeenCalled();
  });
});
