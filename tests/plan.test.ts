import { describe, expect, it } from 'vitest';
import { PLAN_AMOUNT_FIELDS, planFieldErrors, planSpending, type PlanInput } from '../shared/plan';

const input: PlanInput = {
  allowance: '0.04',
  perRequestCap: '0.02',
  dailyAvailable: '0.1',
  allowedTools: ['wallet_snapshot', 'transaction_explain'],
  requests: ['wallet_snapshot', 'transaction_explain', 'transaction_explain'],
};
describe('policy capacity planner', () => {
  it('allocates exact integer costs in order without creating payment evidence', () => {
    const plan = planSpending(input);
    expect(plan.plannedCost).toBe('30000');
    expect(plan.remaining).toBe('10000');
    expect(plan.requests.map((request) => request.decision)).toEqual([
      'within-limit',
      'within-limit',
      'blocked',
    ]);
    expect(plan.paymentSubmitted).toBe(false);
    expect(plan.kind).toBe('policy-plan');
    expect(plan).not.toHaveProperty('signature');
    expect(plan).not.toHaveProperty('settled');
  });
  it('lets a smaller request use capacity left by a blocked request', () => {
    const plan = planSpending({ ...input, requests: [...input.requests, 'wallet_snapshot'] });
    expect(plan.plannedCost).toBe('40000');
    expect(plan.remaining).toBe('0');
    expect(plan.requests[3].decision).toBe('within-limit');
  });
  it('enforces tool permissions and per-request caps independently', () => {
    expect(planSpending({ ...input, allowedTools: [] }).plannedCost).toBe('0');
    const plan = planSpending({ ...input, perRequestCap: '0.019999' });
    expect(plan.requests[1].reason).toContain('per-request cap');
    expect(plan.plannedCost).toBe('10000');
  });
  it('checks the daily capacity exactly and accepts zero remaining daily capacity', () => {
    expect(planSpending({ ...input, dailyAvailable: '0.029999' }).plannedCost).toBe('10000');
    expect(planSpending({ ...input, dailyAvailable: '0.03' }).plannedCost).toBe('30000');
    expect(planSpending({ ...input, dailyAvailable: '0' }).plannedCost).toBe('0');
  });
  it('rejects invalid limits and more than eight requests', () => {
    for (const allowance of ['0', '-1', 'NaN', '1e2', '0.0000001', ''])
      expect(() => planSpending({ ...input, allowance })).toThrow();
    expect(() =>
      planSpending({
        ...input,
        requests: Array.from({ length: 9 }, () => 'wallet_snapshot' as const),
      })
    ).toThrow();
  });
  it('attributes each amount problem to the field it came from', () => {
    // The planner throws the first problem it meets, which is why a form needs
    // this: the message has to be shown at the field that caused it.
    expect(planFieldErrors(input)).toEqual({});
    expect(planFieldErrors({ ...input, allowance: 'abc' })).toEqual({
      allowance: 'Use a positive decimal with at most six decimal places.',
    });
    expect(planFieldErrors({ ...input, perRequestCap: '-5' })).toEqual({
      perRequestCap: 'Use a positive decimal with at most six decimal places.',
    });
    expect(planFieldErrors({ ...input, dailyAvailable: '0.0000001' })).toEqual({
      dailyAvailable: 'Use a positive decimal with at most six decimal places.',
    });
    expect(planFieldErrors({ ...input, allowance: '0', perRequestCap: '0' })).toEqual({
      allowance: 'Enter an amount greater than zero.',
      perRequestCap: 'Enter an amount greater than zero.',
    });
    // Nothing available today is an answer, not a mistake.
    expect(planFieldErrors({ ...input, dailyAvailable: '0' })).toEqual({});
    expect(planFieldErrors({ ...input, allowance: '1000001' })).toEqual({
      allowance: 'Amount exceeds the supported limit.',
    });
  });

  it('covers every amount the planner reads, so none can go unreported', () => {
    expect(PLAN_AMOUNT_FIELDS).toEqual(['allowance', 'perRequestCap', 'dailyAvailable']);
    for (const field of PLAN_AMOUNT_FIELDS) {
      expect(planFieldErrors({ ...input, [field]: 'abc' })).toHaveProperty(field);
      expect(() => planSpending({ ...input, [field]: 'abc' })).toThrow();
    }
  });

  it('reports a field problem without inventing a plan-level one', () => {
    const errors = planFieldErrors({ ...input, allowance: 'abc' });
    expect(Object.keys(errors)).toEqual(['allowance']);
  });

  it('handles an empty plan without mutation of inputs', () => {
    const original = structuredClone(input);
    planSpending(input);
    expect(input).toEqual(original);
    expect(planSpending({ ...input, requests: [] }).remaining).toBe('40000');
  });
});
