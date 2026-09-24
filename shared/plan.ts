import { CATALOG, TOOL_NAMES, formatMoney, parseMoney, type ToolName } from './domain.js';

export interface PlanInput {
  allowance: string;
  perRequestCap: string;
  dailyAvailable: string;
  allowedTools: ToolName[];
  requests: ToolName[];
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
