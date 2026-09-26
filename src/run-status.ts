import { formatMoney, type RunDTO } from '../shared/domain';

/**
 * The one sentence that states how a run ended. The progress card prints it and
 * the live region speaks it, from here, so the two cannot drift apart.
 * Only meaningful once the run has reached a terminal status.
 */
export function runOutcome(run: Pick<RunDTO, 'status' | 'mode'>): string {
  if (run.status === 'completed') return 'Task finished within its allowance.';
  if (run.mode === 'rehearsal')
    return run.status === 'interrupted'
      ? 'Run interrupted. Review the recovery and receipt below.'
      : 'Offline plan ended. No funds moved.';
  return `Run ${run.status}. Start a new run to authorize more work.`;
}

/**
 * What the run says out loud. The meter, the progress card and the activity list
 * are all visual, so the outcome and the figures behind it are mirrored into one
 * spoken sentence for anyone listening to the page instead of watching it.
 */
export function runAnnouncement(
  run: Pick<RunDTO, 'status' | 'mode' | 'settled' | 'held' | 'remaining' | 'events'>,
  running: boolean
): string {
  // Both the fixture cursor and the run's own status have to be finished before
  // this describes an ending, so a state in flight is never called an outcome.
  if (running || run.status === 'running') return 'Running the example.';
  if (run.status === 'queued') return '';
  const entries = run.events.length;
  return [
    runOutcome(run),
    `Settled ${formatMoney(run.settled)}, held ${formatMoney(run.held)}, remaining ${formatMoney(run.remaining)} USDC.`,
    `${entries} activity ${entries === 1 ? 'entry' : 'entries'} recorded.`,
  ].join(' ');
}
