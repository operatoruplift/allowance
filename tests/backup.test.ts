import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from '../server/config.js';
import { openDatabase } from '../server/db/index.js';
import {
  backupDatabase,
  restoreDatabase,
  validateBackup,
  approveRestoredJournal,
} from '../server/db/backup.js';
import { pendingRestore, restoreReadiness } from '../server/db/recovery.js';
import { acquireServiceLease, assertServiceLeaseActive } from '../server/db/lease.js';
import { createRuntime } from '../server/runtime.js';
import { initializeMerchantStore } from '../server/merchant/http.js';
import { createAgentGrant } from '../server/mcp/grants.js';
import { CATALOG, PAYMENT_CHAINS } from '../shared/domain.js';
import type { PurchaseProposal } from '../server/payments/contracts.js';

const roots: string[] = [];
const runtimes: Awaited<ReturnType<typeof createRuntime>>[] = [];
afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.close();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  vi.unstubAllGlobals();
});
const input = {
  wallet: '11111111111111111111111111111111',
  task: 'Controlled backup fixture',
  allowance: '0.04',
  perRequestCap: '0.02',
  expiresInMinutes: 10,
  allowedTools: ['wallet_snapshot' as const, 'transaction_explain' as const],
};
const config = loadConfig({ PAYMENT_NETWORK: 'devnet', MERCHANT_RECIPIENT: input.wallet });
function directory() {
  const root = fs.mkdtempSync(path.join(tmpdir(), 'allowance-backup-'));
  roots.push(root);
  return root;
}
async function runtimeAt(databasePath: string) {
  const runtime = await createRuntime({ ...config, databasePath });
  runtimes.push(runtime);
  return runtime;
}
function proposal(runId: string, id: string, index: number): PurchaseProposal {
  const tool = CATALOG[index];
  return {
    runId,
    requestId: id,
    canonicalHash: `${id}-hash`,
    tool: tool.name,
    amount: tool.price,
    origin: config.origin,
    path: tool.path,
    method: 'POST',
    recipient: config.recipient,
    network: PAYMENT_CHAINS.devnet.network,
    mint: PAYMENT_CHAINS.devnet.mint,
  };
}
const signing = {
  messageHash: 'fixture-message',
  blockhash: 'fixture-original-blockhash',
  payer: 'fixture-payer',
  feeSponsor: 'fixture-sponsor',
};
const fixturePayment = (amount: string) => ({
  x402Version: 2,
  resource: {
    url: config.origin + '/merchant/wallet-snapshot',
    description: 'Controlled backup fixture',
    mimeType: 'application/json',
  },
  accepted: {
    scheme: 'exact',
    network: PAYMENT_CHAINS.devnet.network,
    asset: PAYMENT_CHAINS.devnet.mint,
    amount,
    payTo: config.recipient,
    maxTimeoutSeconds: 60,
    extra: { feePayer: signing.feeSponsor },
  },
  payload: { transaction: 'controlled-backup-payload-not-a-real-payment' },
});

describe('supported SQLite backups and conservative restore', () => {
  it('captures committed WAL, preserves financial identity/cache/session/grants and locks stale restored signing', async () => {
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetcher);
    const root = directory();
    const runtime = await runtimeAt(path.join(root, 'source.sqlite'));
    const { db, ledger } = runtime;
    const run = ledger.createRun(input, 'operator', 'external');
    db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(
      'backup-session',
      Date.now() + 600000,
      JSON.stringify({ operator: 'operator', issuedAt: Date.now() })
    );
    const { grant } = createAgentGrant(db, ledger, {
      runId: run.id,
      owner: 'operator',
      sessionId: 'backup-session',
      expiresAt: run.policy.expiresAt,
    });
    ledger.reserve(proposal(run.id, 'first', 0));
    ledger.markSigning('first', signing);
    ledger.markSigned('first', {
      ...signing,
      payerSignature: 'fixture-signature-first',
      payload: fixturePayment('10000'),
    });
    ledger.markSubmitted('first');
    ledger.markSettled('first', { signature: 'fixture-signature-first', chainVerified: true });
    ledger.markDelivered('first', { fixture: true, fact: 'cached useful output' });
    ledger.reserve(proposal(run.id, 'second', 1));
    ledger.markSigning('second', { ...signing, messageHash: 'fixture-message-second' });
    db.prepare(
      'INSERT INTO buyer_replays(intent_id,request_id,canonical_hash,url,body,tool,amount,requirements_json,payload_json) VALUES(?,?,?,?,?,?,?,?,?)'
    ).run(
      'first',
      'first',
      'first-hash',
      `${config.origin}/merchant/wallet-snapshot`,
      '{}',
      'wallet_snapshot',
      '10000',
      '{}',
      '{"original":true}'
    );
    initializeMerchantStore(db);
    db.prepare(
      'INSERT INTO merchant_receipts(id,canonical_hash,payload_hash,payer,status,result_json,settle_json,payload_json,requirements_json) VALUES(?,?,?,?,?,?,?,?,?)'
    ).run(
      'first',
      'first-hash',
      'payload-hash',
      'fixture-payer',
      'settled',
      '{"cached":true}',
      '{"fixture":true}',
      '{"original":true}',
      '{}'
    );
    const before = ledger.getRun(run.id);
    const backupDir = path.join(root, 'backup');
    const manifest = await backupDatabase(runtime.config.databasePath, backupDir);
    expect(manifest.tables).toMatchObject({
      agent_grants: 1,
      buyer_replays: 1,
      merchant_receipts: 1,
      intents: 2,
      sessions: 1,
    });
    expect(await validateBackup(backupDir)).toEqual(manifest);
    expect(fs.statSync(path.join(backupDir, 'journal.sqlite')).mode & 0o777).toBe(0o600);
    // This occurs after backup: restoring must never treat the older allowance as fresh.
    ledger.markSigned('second', {
      ...signing,
      messageHash: 'fixture-message-second',
      payerSignature: 'fixture-signature-second',
      payload: fixturePayment('20000'),
    });
    ledger.markSubmitted('second');
    const restoredFile = path.join(root, 'restored.sqlite');
    const restored = await restoreDatabase(backupDir, restoredFile);
    const recovered = await runtimeAt(restoredFile);
    const recoveredRun = recovered.ledger.getRun(run.id);
    expect(recoveredRun).toMatchObject({
      authorized: before.authorized,
      settled: '10000',
      held: '20000',
      remaining: '10000',
      status: 'interrupted',
    });
    expect(recoveredRun.purchases[0]).toMatchObject({
      id: 'first',
      signature: 'fixture-signature-first',
      result: { fixture: true, fact: 'cached useful output' },
    });
    expect(recoveredRun.purchases[1]).toMatchObject({
      id: 'second',
      status: 'settlement-unknown',
      originalBlockhash: signing.blockhash,
    });
    expect(recovered.db.prepare('SELECT request_id,payload_json FROM buyer_replays').get()).toEqual(
      { request_id: 'first', payload_json: '{"original":true}' }
    );
    expect(recovered.db.prepare('SELECT result_json FROM merchant_receipts').get()).toEqual({
      result_json: '{"cached":true}',
    });
    expect(
      recovered.db.prepare('SELECT revoked_at FROM agent_grants WHERE id=?').get(grant.id)
    ).toEqual({ revoked_at: null });
    expect(recovered.db.prepare('SELECT sid FROM sessions').get()).toEqual({
      sid: 'backup-session',
    });
    expect(pendingRestore(recovered.db)?.id).toBe(restored.id);
    expect(restoreReadiness(recovered.db).ready).toBe(false);
    expect(() => recovered.ledger.createRun(input)).toThrow(/Restored journal is locked/);
    expect(() => recovered.ledger.checkBeforeSign('second')).toThrow(/Restored journal is locked/);
    expect(() => assertServiceLeaseActive(recovered.db)).toThrow(/Restored journal is locked/);
    const approval = {
      restorationId: restored.id,
      operator: 'test operator',
      reconciledThrough: new Date().toISOString(),
      allPostBackupActivityAccountedFor: true,
      originalPaymentIdentitiesPreserved: true,
      soleAuthoritativeJournal: true,
      notes: 'Controlled fixture: all post-backup payment identities were accounted for.',
    };
    expect(() => approveRestoredJournal(restoredFile, approval)).toThrow(/Stop every service/);
    recovered.close();
    expect(() => approveRestoredJournal(restoredFile, approval)).toThrow(/Original unresolved/);
    const observed = await runtimeAt(restoredFile);
    observed.ledger.markSettled('second', {
      signature: 'fixture-signature-second',
      chainVerified: true,
    });
    observed.close();
    expect(approveRestoredJournal(restoredFile, approval)).toMatchObject({
      signingLocked: false,
      requiresNewAuthorization: true,
    });
    const approved = await runtimeAt(restoredFile);
    expect(restoreReadiness(approved.db).ready).toBe(true);
    expect(
      approved.db.prepare('SELECT revoked_at FROM agent_grants WHERE id=?').get(grant.id)
    ).toMatchObject({ revoked_at: expect.any(Number) });
    expect(approved.ledger.getRun(run.id)).toMatchObject({
      settled: '30000',
      held: '0',
      remaining: '10000',
      status: 'interrupted',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('never overwrites a current journal and rejects corrupt backups', async () => {
    const root = directory();
    const source = path.join(root, 'source.sqlite');
    const runtime = await runtimeAt(source);
    const run = runtime.ledger.createRun(input);
    const backupDir = path.join(root, 'backup');
    await backupDatabase(source, backupDir);
    await expect(backupDatabase(source, backupDir)).rejects.toThrow();
    await expect(restoreDatabase(backupDir, source)).rejects.toThrow(/new database path/);
    expect(runtime.ledger.getRun(run.id).id).toBe(run.id);
    fs.appendFileSync(path.join(backupDir, 'journal.sqlite'), 'corruption');
    await expect(validateBackup(backupDir)).rejects.toThrow(/checksum/);
    await expect(restoreDatabase(backupDir, path.join(root, 'failed.sqlite'))).rejects.toThrow(
      /checksum/
    );
    expect(fs.existsSync(path.join(root, 'failed.sqlite'))).toBe(false);
  });

  it('keeps the ownership heartbeat alive while restore blocks new spending', () => {
    const db = openDatabase(':memory:');
    try {
      db.prepare(
        'INSERT INTO restore_recoveries(id,backup_id,backup_completed_at,restored_at) VALUES(?,?,?,?)'
      ).run('restore', 'backup', new Date().toISOString(), new Date().toISOString());
      let now = 1000;
      const lease = acquireServiceLease(db, () => now);
      expect(() => lease.assert()).toThrow(/Restored journal/);
      now += 10000;
      lease.renew();
      expect(() => acquireServiceLease(db, () => now)).toThrow(/Another Allowance/);
      lease.release();
    } finally {
      db.close();
    }
  });

  it('rejects future schema versions and cleans up failed backups', async () => {
    const root = directory();
    const file = path.join(root, 'newer.sqlite');
    const db = openDatabase(file);
    db.prepare('INSERT INTO schema_migrations VALUES(999,?)').run(new Date().toISOString());
    db.close();
    expect(() => openDatabase(file)).toThrow(/newer than this application/);
    const failed = path.join(root, 'unsupported-backup');
    await expect(backupDatabase(file, failed)).rejects.toThrow(/not supported/);
    expect(fs.existsSync(failed)).toBe(false);
  });
});
