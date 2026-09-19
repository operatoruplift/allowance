import { CATALOG, PAYMENT_CHAINS, units, type Policy } from './domain.js';
import type { PurchaseProposal } from '../server/payments/contracts.js';
export interface PolicyContext {
  policy: Policy;
  status: string;
  settled: number;
  held: number;
  dailyUsed: number;
  dailyCeiling: number;
  calls: number;
  payerFrozen: boolean;
  now: number;
}
export function decision(
  context: PolicyContext,
  proposal: PurchaseProposal
): { allowed: boolean; reason: string } {
  const { policy } = context;
  const deny = (reason: string) => ({ allowed: false, reason });
  const catalog = CATALOG.find((t) => t.name === proposal.tool);
  if (!catalog || !policy.allowedTools.includes(proposal.tool))
    return deny('Service is not permitted by this policy.');
  if (
    proposal.method !== 'POST' ||
    proposal.origin !== policy.origin ||
    proposal.path !== catalog.path
  )
    return deny('Request destination is outside the exact allowlist.');
  const chain = Object.values(PAYMENT_CHAINS).find((item) => item.network === policy.network);
  if (!chain || proposal.network !== policy.network)
    return deny('Payment network does not match the immutable policy.');
  if (policy.mint !== chain.mint || proposal.mint !== policy.mint)
    return deny('Asset mint does not match the policy network’s native USDC.');
  if (proposal.recipient !== policy.recipient) return deny('Merchant recipient changed.');
  let amount: number;
  try {
    amount = units(proposal.amount);
  } catch {
    return deny('Invalid integer price.');
  }
  if (proposal.amount !== catalog.price)
    return deny('Price changed from the approved catalog amount.');
  if (amount > units(policy.perRequestCap)) return deny('Per-request maximum exceeded.');
  if (context.now >= Date.parse(policy.expiresAt)) return deny('Policy has expired.');
  if (policy.runtimeExpiresAt && context.now >= Date.parse(policy.runtimeExpiresAt))
    return deny('Agent runtime authorization has expired.');
  if (!['queued', 'running'].includes(context.status))
    return deny('Run is no longer authorized to create payments.');
  if (context.payerFrozen)
    return deny('A prior payment has an uncertain outcome; this payer is held for reconciliation.');
  if (context.calls >= policy.callLimit) return deny('Paid call limit reached.');
  if (context.settled + context.held + amount > units(policy.allowance))
    return deny('Request exceeds the remaining allowance.');
  if (context.dailyUsed + amount > Math.min(context.dailyCeiling, units(policy.dailyCeiling)))
    return deny('Operator daily ceiling exceeded.');
  return { allowed: true, reason: 'Within the immutable policy and shared daily ceiling.' };
}
export class PolicyError extends Error {
  readonly code = 'POLICY_DENIED';
}
