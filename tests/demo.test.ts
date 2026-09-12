import { expect, it } from 'vitest';
import { createDemo, demoProbe, fixtureStep } from '../src/demo.js';
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
