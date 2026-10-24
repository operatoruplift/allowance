import type Database from 'better-sqlite3';

export const AUTH_MAINTENANCE_INTERVAL_MS = 15 * 60 * 1000;

/** Removes expired session rows and lapsed sign-in lockout counters. */
export function pruneExpiredAuthRows(
  db: Database.Database,
  now: number = Date.now()
): { sessions: number; attempts: number } {
  return db
    .transaction(() => ({
      sessions: db.prepare('DELETE FROM sessions WHERE expires<=?').run(now).changes,
      attempts: db.prepare('DELETE FROM login_attempts WHERE expires<=?').run(now).changes,
    }))
    .immediate();
}

/**
 * Prunes once now and then on a timer, so expired rows do not wait for the next
 * restart. The timer never keeps the process alive; the returned function stops it.
 */
export function startAuthMaintenance(
  db: Database.Database,
  intervalMs = AUTH_MAINTENANCE_INTERVAL_MS,
  now: () => number = Date.now
): () => void {
  const prune = () => {
    try {
      if (db.open) pruneExpiredAuthRows(db, now());
    } catch {
      process.stderr.write('Session maintenance failed; expired rows remain until the next pass.\n');
    }
  };
  prune();
  const timer = setInterval(prune, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
