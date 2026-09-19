import { PAYMENT_CHAINS } from '../shared/domain.js';
import { expect, it } from 'vitest';
import { createDemo, demoProbe, fixtureStep, reconcileDemo, stopDemo } from '../src/demo.js';
it('rehearses two purchases and the shared policy guard without a third charge or invented signature', () => {
  let run = createDemo();
  for (let step = 0; step < 6; step++) run = fixtureStep(run, step, 'standard');
  expect(run.purchases).toHaveLength(2);
  run = demoProbe(run);
  expect(run).toMatchObject({ settled: '30000', held: '0', remaining: '10000' });
  expect(run.purchases[2]).toMatchObject({
    status: 'denied',
    source: 'policy-probe',
    reason: 'Request exceeds the remaining allowance.',
  });
  expect(run.purchases.every((p) => !p.signature)).toBe(true);
});
it('does not invent a budget denial when the pure policy allows a fixture proposal', () => {
  let run = createDemo();
  for (let step = 0; step < 3; step++) run = fixtureStep(run, step, 'empty');
  run = demoProbe(run);
  expect(run.purchases).toHaveLength(1);
  expect(run.events.at(-1)?.title).toBe('Policy probe would fit');
});

it('keeps an ambiguous signed fixture held until reconciliation without a duplicate purchase', () => {
  let run = createDemo();
  for (let step = 0; step < 3; step++) run = fixtureStep(run, step, 'ambiguous');
  expect(run).toMatchObject({
    status: 'interrupted',
    settled: '0',
    held: '10000',
    remaining: '30000',
  });
  expect(run.purchases).toHaveLength(1);
  expect(run.purchases[0]).toMatchObject({
    status: 'settlement-unknown',
    serviceOutcome: 'pending',
  });
  const recovered = reconcileDemo(run);
  expect(recovered).toMatchObject({
    status: 'interrupted',
    settled: '10000',
    held: '0',
    remaining: '30000',
  });
  expect(recovered.error).toContain('delivery unavailable');
  expect(recovered.purchases).toHaveLength(1);
  expect(recovered.purchases[0]).toMatchObject({
    status: 'settled-but-result-unavailable',
    serviceOutcome: 'unavailable',
  });
  expect(recovered.purchases.every((purchase) => !purchase.signature)).toBe(true);
});

it('describes mainnet in its policy and export while retaining explicit rehearsal evidence', () => {
  const run = createDemo();
  expect(run).toMatchObject({
    mode: 'rehearsal',
    paymentNetwork: 'mainnet',
    dataNetwork: 'mainnet',
  });
  expect(run.policy.network).toBe(PAYMENT_CHAINS.mainnet.network);
  expect(run.policy.mint).toBe(PAYMENT_CHAINS.mainnet.mint);
  expect(run.llm.note).toContain('No model is called');
});

it('stops an unsigned request, releases its reservation, and starts the next example cleanly', () => {
  let run = createDemo();
  run = fixtureStep(run, 0, 'standard');
  run = fixtureStep(run, 1, 'standard');
  const stopped = stopDemo(run);
  expect(stopped).toMatchObject({ status: 'stopped', settled: '0', held: '0', remaining: '40000' });
  expect(stopped.purchases[0]).toMatchObject({ status: 'released', chainVerified: false });
  expect(run.purchases[0].status).toBe('reserved');
  expect(stopDemo(stopped)).toEqual(stopped);
  expect(createDemo()).toMatchObject({
    status: 'queued',
    purchases: [],
    events: [],
    remaining: '40000',
  });
});

it('retains delivered work when stopped and makes the separate denial idempotent', () => {
  let run = createDemo();
  for (let step = 0; step < 4; step++) run = fixtureStep(run, step, 'standard');
  const stopped = stopDemo(run);
  expect(stopped).toMatchObject({
    status: 'stopped',
    settled: '10000',
    held: '0',
    remaining: '30000',
  });
  expect(stopped.purchases.map((purchase) => purchase.status)).toEqual(['delivered', 'released']);
  for (let step = 4; step < 6; step++) run = fixtureStep(run, step, 'standard');
  const probed = demoProbe(run);
  expect(demoProbe(probed)).toEqual(probed);
  expect(probed.purchases).toHaveLength(3);
});

it('does not release or relabel ambiguous evidence through stop', () => {
  let run = createDemo();
  for (let step = 0; step < 3; step++) run = fixtureStep(run, step, 'ambiguous');
  expect(stopDemo(run)).toEqual(run);
  const recovered = reconcileDemo(run);
  expect(reconcileDemo(recovered)).toEqual(recovered);
});
