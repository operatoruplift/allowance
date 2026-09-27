import {
  getBase58Decoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
} from '@solana/kit';
import { PAYMENT_CHAINS, type PaymentNetwork } from '../../shared/domain.js';
import type { DirectRpc } from '../../server/direct/transfer.js';

interface TokenAccount {
  owner: string;
  mint: string;
  amount: bigint;
}
interface Landed {
  wire: string;
  slot: number;
  err: unknown;
  pre: { accountIndex: number; mint: string; owner: string; amount: bigint }[];
  post: { accountIndex: number; mint: string; owner: string; amount: bigint }[];
}

/**
 * A deterministic stand-in for a devnet RPC. It holds token balances, applies a
 * submitted TransferChecked when the transaction "lands", and answers every
 * method the direct rail reads with the same JSON shapes as a real node.
 */
export class FakeChain implements DirectRpc {
  readonly network: PaymentNetwork = 'devnet';
  readonly calls: { method: string; params: unknown[] }[] = [];
  readonly tokenAccounts = new Map<string, TokenAccount>();
  readonly lamports = new Map<string, bigint>();
  readonly landed = new Map<string, Landed>();
  readonly submitted: string[] = [];
  blockHeight = 1000n;
  lastValidBlockHeight = 1150n;
  blockhash = 'GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi';
  feeLamports = 5000;
  simulationError: unknown = null;
  sendError: Error | null = null;
  /** How many status polls return null before a submitted transaction is confirmed. */
  confirmAfterPolls = 0;
  /** When true, a submitted transaction never lands (used with a lapsed block height). */
  neverLands = false;
  /** When set, the landed transaction carries this error and moves no funds. */
  landWithError: unknown = null;
  private polls = new Map<string, number>();
  private slot = 5000;

  fund(tokenAccount: string, owner: string, amount: bigint, mint = PAYMENT_CHAINS.devnet.mint) {
    this.tokenAccounts.set(tokenAccount, { owner, mint, amount });
  }
  async assertNetwork() {
    if ((await this.call('getGenesisHash', [])) !== PAYMENT_CHAINS.devnet.genesisHash)
      throw new Error('wrong network');
  }
  methods(method: string) {
    return this.calls.filter((call) => call.method === method);
  }
  async call(method: string, params: unknown[]): Promise<unknown> {
    this.calls.push({ method, params });
    switch (method) {
      case 'getGenesisHash':
        return PAYMENT_CHAINS.devnet.genesisHash;
      case 'getAccountInfo': {
        const account = this.tokenAccounts.get(params[0] as string);
        if (!account) return { value: null };
        return {
          value: {
            owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
            data: {
              parsed: {
                type: 'account',
                info: {
                  mint: account.mint,
                  owner: account.owner,
                  state: 'initialized',
                  tokenAmount: { amount: String(account.amount), decimals: 6 },
                },
              },
            },
          },
        };
      }
      case 'getBalance':
        return { value: Number(this.lamports.get(params[0] as string) ?? 0n) };
      case 'getLatestBlockhash':
        return {
          value: { blockhash: this.blockhash, lastValidBlockHeight: Number(this.lastValidBlockHeight) },
        };
      case 'getFeeForMessage':
        return { value: this.feeLamports };
      case 'simulateTransaction':
        return { value: { err: this.simulationError, logs: [] } };
      case 'isBlockhashValid':
        return { value: this.blockHeight <= this.lastValidBlockHeight };
      case 'getBlockHeight':
        return Number(this.blockHeight);
      case 'sendTransaction': {
        if (this.sendError) throw this.sendError;
        const wire = params[0] as string;
        const signature = this.land(wire);
        this.submitted.push(signature);
        return signature;
      }
      case 'getSignatureStatuses': {
        const [signature] = params[0] as string[];
        const landed = this.landed.get(signature);
        if (!landed || this.neverLands) return { value: [null] };
        const seen = (this.polls.get(signature) ?? 0) + 1;
        this.polls.set(signature, seen);
        if (seen <= this.confirmAfterPolls) return { value: [null] };
        return { value: [{ slot: landed.slot, confirmationStatus: 'confirmed', err: landed.err }] };
      }
      case 'getTransaction': {
        const landed = this.landed.get(params[0] as string);
        if (!landed || this.neverLands) return null;
        const balances = (list: Landed['pre']) =>
          list.map((entry) => ({
            accountIndex: entry.accountIndex,
            mint: entry.mint,
            owner: entry.owner,
            uiTokenAmount: { amount: String(entry.amount), decimals: 6 },
          }));
        return {
          slot: landed.slot,
          transaction: [landed.wire, 'base64'],
          meta: {
            err: landed.err,
            fee: this.feeLamports,
            preTokenBalances: balances(landed.pre),
            postTokenBalances: balances(landed.post),
          },
        };
      }
      default:
        throw new Error(`FakeChain does not implement ${method}`);
    }
  }
  /** Applies the single TransferChecked in the wire to the fake balances and records the landing. */
  private land(wire: string): string {
    const transaction = getTransactionDecoder().decode(Buffer.from(wire, 'base64'));
    const signature = getBase58Decoder().decode(Object.values(transaction.signatures)[0]!);
    const message = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes);
    const keys = message.staticAccounts.map(String);
    const transfer = message.instructions.find(
      (instruction) =>
        keys[instruction.programAddressIndex] === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' &&
        instruction.data?.[0] === 12
    );
    if (!transfer || !transfer.accountIndices || !transfer.data) throw new Error('No TransferChecked in wire.');
    const [sourceIndex, mintIndex, destinationIndex, authorityIndex] = transfer.accountIndices;
    const amount = Buffer.from(transfer.data).readBigUInt64LE(1);
    const source = keys[sourceIndex];
    const destination = keys[destinationIndex];
    const mint = keys[mintIndex];
    const authority = keys[authorityIndex];
    const from = this.tokenAccounts.get(source);
    if (!from) throw new Error('Source account missing in FakeChain.');
    const creating = !this.tokenAccounts.has(destination);
    const ataInstruction = message.instructions.find(
      (instruction) => keys[instruction.programAddressIndex] === 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'
    );
    const recipientOwner = creating && ataInstruction?.accountIndices ? keys[ataInstruction.accountIndices[2]] : this.tokenAccounts.get(destination)!.owner;
    const pre = [{ accountIndex: sourceIndex, mint, owner: authority, amount: from.amount }];
    if (!creating) pre.push({ accountIndex: destinationIndex, mint, owner: recipientOwner, amount: this.tokenAccounts.get(destination)!.amount });
    const err = this.landWithError;
    let post = pre;
    if (err === null) {
      const toBefore = this.tokenAccounts.get(destination)?.amount ?? 0n;
      this.tokenAccounts.set(source, { ...from, amount: from.amount - amount });
      this.tokenAccounts.set(destination, { owner: recipientOwner, mint, amount: toBefore + amount });
      post = [
        { accountIndex: sourceIndex, mint, owner: authority, amount: from.amount - amount },
        { accountIndex: destinationIndex, mint, owner: recipientOwner, amount: toBefore + amount },
      ];
    }
    this.landed.set(signature, { wire, slot: ++this.slot, err, pre, post });
    return signature;
  }
}
