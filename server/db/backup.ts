import Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { openDatabase, SCHEMA_VERSION } from './index.js';
import { pendingRestore } from './recovery.js';

const manifestSchema = z
  .object({
    format: z.literal(1),
    id: z.uuid(),
    completedAt: z.iso.datetime(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    schemaVersion: z.number().int().min(1).max(SCHEMA_VERSION),
    tables: z.record(z.string(), z.number().int().nonnegative()),
  })
  .strict();
export type BackupManifest = z.infer<typeof manifestSchema>;

function inspect(db: Database.Database) {
  if (db.pragma('quick_check', { simple: true }) !== 'ok')
    throw new Error('SQLite integrity validation failed.');
  if ((db.pragma('foreign_key_check') as unknown[]).length !== 0)
    throw new Error('SQLite foreign-key validation failed.');
  const row = db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as {
    version: number;
  };
  if (!Number.isSafeInteger(row.version) || row.version < 1 || row.version > SCHEMA_VERSION)
    throw new Error('Backup schema is not supported by this application.');
  const names = db
    .prepare(
      "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    )
    .all() as { name: string }[];
  const tables = Object.fromEntries(
    names.map(({ name }) => {
      const { count } = db
        .prepare(`SELECT count(*) AS count FROM "${name.replaceAll('"', '""')}"`)
        .get() as { count: number };
      return [name, count];
    })
  );
  return { schemaVersion: row.version, tables };
}

async function digest(filename: string) {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex');
}

function syncFile(filename: string) {
  const fd = fs.openSync(filename, 'r');
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function requireRegularFile(filename: string) {
  if (!fs.lstatSync(filename).isFile())
    throw new Error('Expected a regular database or manifest file.');
}

/** SQLite's online backup includes committed WAL pages without copying a live .sqlite file. */
export async function backupDatabase(source: string, directory: string): Promise<BackupManifest> {
  requireRegularFile(source);
  fs.mkdirSync(directory, { mode: 0o700 }); // Never replace a previous backup.
  try {
    const filename = path.join(directory, 'journal.sqlite');
    const sourceDb = new Database(source, { readonly: true, fileMustExist: true });
    try {
      inspect(sourceDb);
      await sourceDb.backup(filename);
    } finally {
      sourceDb.close();
    }
    fs.chmodSync(filename, 0o600);
    const snapshot = new Database(filename, { readonly: true, fileMustExist: true });
    let inspection: ReturnType<typeof inspect>;
    try {
      inspection = inspect(snapshot);
    } finally {
      snapshot.close();
    }
    syncFile(filename);
    const manifest: BackupManifest = {
      format: 1,
      id: randomUUID(),
      completedAt: new Date().toISOString(),
      sha256: await digest(filename),
      ...inspection,
    };
    const manifestFile = path.join(directory, 'manifest.json');
    fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, {
      mode: 0o600,
      flag: 'wx',
    });
    syncFile(manifestFile);
    syncFile(directory);
    return manifest;
  } catch (error) {
    fs.rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

export async function validateBackup(directory: string): Promise<BackupManifest> {
  const filename = path.join(directory, 'journal.sqlite');
  const manifestFile = path.join(directory, 'manifest.json');
  requireRegularFile(filename);
  requireRegularFile(manifestFile);
  if (fs.statSync(manifestFile).size > 65536)
    throw new Error('Backup manifest exceeds its size limit.');
  const manifest = manifestSchema.parse(JSON.parse(fs.readFileSync(manifestFile, 'utf8')));
  if ((await digest(filename)) !== manifest.sha256)
    throw new Error('Backup checksum does not match.');
  const snapshot = new Database(filename, { readonly: true, fileMustExist: true });
  try {
    const inspection = inspect(snapshot);
    if (
      inspection.schemaVersion !== manifest.schemaVersion ||
      JSON.stringify(inspection.tables) !== JSON.stringify(manifest.tables)
    )
      throw new Error('Backup table inventory does not match.');
  } finally {
    snapshot.close();
  }
  return manifest;
}

/** Restore to a new pathname; replacing the funded service's open DB is never supported. */
export async function restoreDatabase(directory: string, destination: string) {
  const manifest = await validateBackup(directory);
  for (const suffix of ['', '-wal', '-shm']) {
    if (fs.existsSync(`${destination}${suffix}`))
      throw new Error(
        'Restore requires a new database path without WAL or SHM files. Stop the service and preserve the original volume.'
      );
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  const stage = `${destination}.restore-${randomUUID()}`;
  let db: Database.Database | undefined;
  const id = randomUUID();
  const restoredAt = new Date().toISOString();
  try {
    fs.copyFileSync(path.join(directory, 'journal.sqlite'), stage, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(stage, 0o600);
    db = openDatabase(stage);
    db.transaction(() => {
      db!
        .prepare(
          'INSERT INTO restore_recoveries(id,backup_id,backup_completed_at,restored_at) VALUES(?,?,?,?)'
        )
        .run(id, manifest.id, manifest.completedAt, restoredAt);
      const leaseExists = db!
        .prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='service_lease'")
        .get();
      if (leaseExists) db!.prepare('DELETE FROM service_lease').run();
      db!
        .prepare(
          "UPDATE runs SET status='interrupted',error='Journal restored. Old agent authorization will not resume.' WHERE status IN ('running','queued')"
        )
        .run();
    }).immediate();
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.close();
    db = undefined;
    syncFile(stage);
    // Hard linking fails atomically if another process created the destination.
    fs.linkSync(stage, destination);
    fs.unlinkSync(stage);
    syncFile(path.dirname(destination));
    return { id, backupId: manifest.id, restoredAt, signingLocked: true as const };
  } finally {
    db?.close();
    for (const suffix of ['', '-wal', '-shm']) {
      if (fs.existsSync(`${stage}${suffix}`)) fs.unlinkSync(`${stage}${suffix}`);
    }
  }
}

export const recoveryApprovalSchema = z
  .object({
    restorationId: z.uuid(),
    operator: z.string().trim().min(1).max(100),
    reconciledThrough: z.iso.datetime(),
    allPostBackupActivityAccountedFor: z.literal(true),
    originalPaymentIdentitiesPreserved: z.literal(true),
    soleAuthoritativeJournal: z.literal(true),
    notes: z.string().trim().min(40).max(4000),
  })
  .strict();

/** An explicit operator attestation, never automatic proof that a stale backup is complete. */
export function approveRestoredJournal(filename: string, input: unknown, now = Date.now()) {
  const approval = recoveryApprovalSchema.parse(input);
  requireRegularFile(filename);
  const db = openDatabase(filename);
  try {
    return db
      .transaction(() => {
        const leaseExists = db
          .prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='service_lease'")
          .get();
        const lease = leaseExists
          ? (db.prepare('SELECT expires FROM service_lease WHERE singleton=1').get() as
              { expires: number } | undefined)
          : undefined;
        if (lease && lease.expires > now)
          throw new Error('Stop every service and MCP process before approving recovery.');
        const restore = pendingRestore(db);
        if (!restore || restore.id !== approval.restorationId)
          throw new Error('Recovery approval does not identify the current locked restore.');
        const through = Date.parse(approval.reconciledThrough);
        if (through < Date.parse(restore.restored_at) || through > now || now - through > 300000)
          throw new Error(
            'Reconciliation must cover the restored journal through the last five minutes.'
          );
        const unresolved = db
          .prepare(
            "SELECT 1 FROM intents WHERE status IN ('reserved','submitted','settlement-unknown') OR (status IN ('settled','delivered','settled-but-result-unavailable') AND chain_verified=0) LIMIT 1"
          )
          .get();
        if (unresolved)
          throw new Error(
            'Original unresolved payments must be reconciled before releasing the restore lock.'
          );
        const merchantExists = db
          .prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='merchant_receipts'")
          .get();
        if (
          merchantExists &&
          db
            .prepare(
              "SELECT 1 FROM merchant_receipts WHERE status IN ('settling','unknown') LIMIT 1"
            )
            .get()
        )
          throw new Error(
            'Merchant settlement ambiguity must be resolved before releasing the restore lock.'
          );
        const approvedAt = new Date(now).toISOString();
        db.prepare('UPDATE agent_grants SET revoked_at=COALESCE(revoked_at,?)').run(now);
        db.prepare(
          "UPDATE runs SET status='interrupted',error='Recovery approved; authorize a new run to spend.' WHERE status IN ('queued','running')"
        ).run();
        db.prepare(
          'UPDATE restore_recoveries SET approved_at=?,approval_json=? WHERE approved_at IS NULL'
        ).run(approvedAt, JSON.stringify(approval));
        return { id: restore.id, approvedAt, signingLocked: false, requiresNewAuthorization: true };
      })
      .immediate();
  } finally {
    db.close();
  }
}
