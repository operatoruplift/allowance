import type Database from 'better-sqlite3';

export interface RestoreRecovery {
  id: string;
  backup_id: string;
  backup_completed_at: string;
  restored_at: string;
  approved_at: string | null;
}

/** A backup can omit later signatures. Local balance alone cannot clear this lock. */
export function pendingRestore(db: Database.Database): RestoreRecovery | undefined {
  return db
    .prepare(
      'SELECT id,backup_id,backup_completed_at,restored_at,approved_at FROM restore_recoveries WHERE approved_at IS NULL ORDER BY restored_at DESC LIMIT 1'
    )
    .get() as RestoreRecovery | undefined;
}

export function assertRestoreApproved(db: Database.Database) {
  if (pendingRestore(db))
    throw new Error(
      'Restored journal is locked. Reconcile original payments and complete offline operator recovery before authorizing new spending.'
    );
}

export function restoreReadiness(db: Database.Database) {
  return {
    name: 'Journal recovery',
    ready: !pendingRestore(db),
    detail: pendingRestore(db)
      ? 'Backup restore requires original-payment reconciliation and offline operator recovery approval. New spending is disabled.'
      : 'No unapproved backup restore is present.',
  };
}
