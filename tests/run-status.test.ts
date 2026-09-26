import { describe, expect, it } from 'vitest';
import { createDemo, demoProbe, fixtureStep, reconcileDemo, stopDemo } from '../src/demo.js';
import { runAnnouncement, runOutcome } from '../src/run-status.js';

// The run outcome, the budget meter and the activity list are all visual. A
// rehearsal that finishes therefore has to say so in text as well, or a screen
// reader hears nothing at all between pressing the trigger and reading the whole
// page again. These are the sentences the live region carries.

const finished = () => {
  let run = createDemo();
  for (let step = 0; step < 6; step++) run = fixtureStep(run, step, 'standard');
  return run;
};

describe('run outcome sentence', () => {
  it('is the same text the progress card prints, for every terminal status', () => {
    expect(runOutcome({ status: 'completed', mode: 'rehearsal' })).toBe(
      'Task finished within its allowance.'
    );
    expect(runOutcome({ status: 'interrupted', mode: 'rehearsal' })).toBe(
      'Run interrupted. Review the recovery and receipt below.'
    );
    expect(runOutcome({ status: 'stopped', mode: 'rehearsal' })).toBe(
      'Offline plan ended. No funds moved.'
    );
    expect(runOutcome({ status: 'failed', mode: 'live' })).toBe(
      'Run failed. Start a new run to authorize more work.'
    );
  });
});

describe('run announcement', () => {
  it('says nothing before the first run and states the work while it advances', () => {
    expect(runAnnouncement(createDemo(), false)).toBe('');
    expect(runAnnouncement(createDemo(), true)).toBe('Running the example.');
  });

  it('carries the outcome, the settled figures and the activity count when it ends', () => {
    const run = finished();
    expect(run.status).toBe('completed');
    expect(runAnnouncement(run, false)).toBe(
      'Task finished within its allowance. Settled 0.030000, held 0.000000, remaining 0.010000 USDC. 6 activity entries recorded.'
    );
  });

  it('follows the separate policy probe, which adds a denial and an entry', () => {
    const run = finished();
    const probed = demoProbe(run);
    expect(runAnnouncement(probed, false)).not.toBe(runAnnouncement(run, false));
    expect(runAnnouncement(probed, false)).toContain('7 activity entries recorded.');
    expect(runAnnouncement(probed, false)).toContain('remaining 0.010000 USDC.');
  });

  it('states a stop and a recovery as the run itself reports them', () => {
    let run = createDemo();
    run = fixtureStep(run, 0, 'standard');
    run = fixtureStep(run, 1, 'standard');
    expect(runAnnouncement(stopDemo(run), false)).toContain('Offline plan ended. No funds moved.');
    let ambiguous = createDemo();
    for (let step = 0; step < 3; step++) ambiguous = fixtureStep(ambiguous, step, 'ambiguous');
    expect(runAnnouncement(reconcileDemo(ambiguous), false)).toContain(
      'Run interrupted. Review the recovery and receipt below.'
    );
  });

  it('counts a single entry in the singular', () => {
    const started = fixtureStep(createDemo(), 0, 'standard');
    expect(started.events).toHaveLength(1);
    expect(runAnnouncement({ ...started, status: 'completed' }, false)).toContain(
      '1 activity entry recorded.'
    );
  });

  it('never calls a run in flight an outcome, whichever signal is behind', () => {
    const started = fixtureStep(createDemo(), 0, 'standard');
    expect(started.status).toBe('running');
    expect(runAnnouncement(started, false)).toBe('Running the example.');
    expect(runAnnouncement({ ...started, status: 'completed' }, true)).toBe('Running the example.');
  });
});
