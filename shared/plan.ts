import { CATALOG, TOOL_NAMES, formatMoney, parseMoney, type ToolName } from './domain.js';

export interface PlanInput {
  allowance: string;
  perRequestCap: string;
  dailyAvailable: string;
  allowedTools: ToolName[];
  requests: ToolName[];
}

/** The three amount fields, in the order the lab presents them. */
export const PLAN_AMOUNT_FIELDS = ['allowance', 'perRequestCap', 'dailyAvailable'] as const;
export type PlanAmountField = (typeof PLAN_AMOUNT_FIELDS)[number];

/**
 * Which field each amount problem belongs to, so a form can show the message
 * beside the input that caused it instead of in one shared banner. `planSpending`
 * throws the first problem it meets; this reports every field at once.
 */
export function planFieldErrors(input: PlanInput): Partial<Record<PlanAmountField, string>> {
  const errors: Partial<Record<PlanAmountField, string>> = {};
  for (const field of PLAN_AMOUNT_FIELDS) {
    try {
      // A daily figure of zero is a real answer: nothing is available today.
      if (parseMoney(input[field]) === 0 && field !== 'dailyAvailable')
        errors[field] = 'Enter an amount greater than zero.';
    } catch (cause) {
      errors[field] = cause instanceof Error ? cause.message : 'Enter an amount in USDC.';
    }
  }
  return errors;
}

/** Capacity planning only. This is neither an executable policy nor a payment receipt. */
export function planSpending(input: PlanInput) {
  const allowance = parseMoney(input.allowance);
  const perRequestCap = parseMoney(input.perRequestCap);
  const dailyAvailable = parseMoney(input.dailyAvailable);
  if (allowance === 0 || perRequestCap === 0)
    throw new Error('Allowance and per-request cap must be greater than zero.');
  if (input.requests.length > 8) throw new Error('Plan up to eight tool requests at a time.');
  if ([...input.requests, ...input.allowedTools].some((tool) => !TOOL_NAMES.includes(tool)))
    throw new Error('Choose a tool from the approved catalog.');
  let allocated = 0;
  const requests = input.requests.map((name, index) => {
    const tool = CATALOG.find((item) => item.name === name)!;
    const amount = Number(tool.price);
    const reason = !input.allowedTools.includes(name)
      ? 'This tool is outside your permitted services.'
      : amount > perRequestCap
        ? 'This price exceeds your per-request cap.'
        : allocated + amount > allowance
          ? 'This request exceeds your remaining allowance.'
          : allocated + amount > dailyAvailable
            ? 'This request exceeds your available daily capacity.'
            : null;
    if (!reason) allocated += amount;
    return {
      position: index + 1,
      tool: name,
      title: tool.title,
      amount: tool.price,
      decision: reason ? ('blocked' as const) : ('within-limit' as const),
      reason: reason ?? 'Fits your tool list, request cap, allowance, and daily capacity.',
      remaining: String(allowance - allocated),
    };
  });
  return {
    kind: 'policy-plan' as const,
    version: 1 as const,
    network: 'mainnet' as const,
    paymentSubmitted: false as const,
    currency: 'USDC' as const,
    amountUnit: 'micro-USDC' as const,
    limits: {
      allowance: String(allowance),
      perRequestCap: String(perRequestCap),
      dailyAvailable: String(dailyAvailable),
      allowedTools: [...input.allowedTools],
    },
    plannedCost: String(allocated),
    remaining: String(allowance - allocated),
    dailyRemaining: String(Math.max(0, dailyAvailable - allocated)),
    requests,
    note: `Planning only. No funds moved. ${formatMoney(allocated)} USDC in planned tool costs. Execution requires an authenticated server policy, current payment readiness, and settlement verification. SOL fees and model usage are separate.`,
  };
}
