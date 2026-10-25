import { z } from 'zod';
import { TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import { PaymentError } from '../payments/guard.js';

export const SYSTEM_PROGRAM_ADDRESS = '11111111111111111111111111111111';
export const TOKEN_2022_PROGRAM_ADDRESS = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

/** What the recipient address itself is on chain, read before any token-account work. */
export type RecipientAccountKind =
  | 'absent'
  | 'wallet'
  | 'token-account'
  | 'mint'
  | 'program'
  | 'program-owned';

const accountSchema = z.object({
  owner: z.string(),
  executable: z.boolean(),
  data: z.unknown(),
});
const parsedTypeSchema = z.object({ parsed: z.object({ type: z.string() }) });

/**
 * Classifies the raw `getAccountInfo` value of a recipient address. USDC lands in
 * the recipient's associated token account, which anyone may create, so the
 * address itself must be something that can sign for that account: a
 * system-owned wallet, or an address with no account yet. A token account, a
 * mint or a program pasted as the recipient would route funds to an account
 * nobody can move them out of.
 */
export function classifyRecipientAccount(value: unknown): RecipientAccountKind {
  if (value === null || value === undefined) return 'absent';
  const account = accountSchema.parse(value);
  if (account.executable) return 'program';
  if (account.owner === SYSTEM_PROGRAM_ADDRESS) return 'wallet';
  if (account.owner === TOKEN_PROGRAM_ADDRESS || account.owner === TOKEN_2022_PROGRAM_ADDRESS) {
    const parsed = parsedTypeSchema.safeParse(account.data);
    const type = parsed.success ? parsed.data.parsed.type : '';
    if (type === 'mint') return 'mint';
    if (type === 'account') return 'token-account';
  }
  return 'program-owned';
}

const REJECTIONS: Record<Exclude<RecipientAccountKind, 'absent' | 'wallet'>, string> = {
  'token-account': 'The recipient must be a wallet address, not a token account.',
  mint: 'The recipient is a token mint, not a wallet address.',
  program: 'The recipient is an executable program, not a wallet address.',
  'program-owned':
    'The recipient is a program-owned account. Only an administrator approval with allowProgramOwnedRecipient can authorize paying it.',
};

/** Refuses every recipient that is not a wallet or an unused address, unless the operator opted a program-owned account in. */
export function assertRecipientAccount(kind: RecipientAccountKind, allowProgramOwned: boolean): void {
  if (kind === 'absent' || kind === 'wallet') return;
  if (kind === 'program-owned' && allowProgramOwned) return;
  throw new PaymentError('recipient-account', REJECTIONS[kind]);
}
