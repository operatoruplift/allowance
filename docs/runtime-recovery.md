# Persistent runtime, backup and recovery

Last updated: **20 September 2026**.

This runbook describes the Express service and its durable SQLite journal. It does not turn the static Vercel rehearsal into a backend. The supplied production image runs Node **22.19.0**, compiled server code and production dependencies as the unprivileged `node` user (UID 1000). `compose.yaml` starts exactly one instance with a named `/data` volume, a read-only root filesystem, no Linux capabilities, a 40-second stop grace period and a loopback-only port. Never scale this service horizontally or reuse its payer in another database.

The Docker image includes the native `better-sqlite3` dependency and compiled database maintenance commands. CI is configured to build the image and exercise it without container networking; consult the [dated release evidence](release-2026-09-20.md) for the observed result. Local Node tests separately exercise online backup, restore, shutdown and real subprocess lease exclusion. Docker is not available on the implementation workstation; a local container execution is not claimed.

## First start

1. Prepare the ignored `.env` with `APP_ORIGIN=https://<your-real-console-host>`, operator hash/session secret, correct proxy hops and reviewed network/data configuration. The Compose file overrides `HOST`, `PORT` and `DATABASE_PATH`; it also forces live payments off and removes payer-key configuration for the initial start.
2. Run `docker compose build` and `docker compose up -d`. The volume must remain writable by UID 1000. A new named Docker volume inherits the image's `/data` ownership. For a bind-mounted volume, create it privately with the matching owner before starting; never make the journal world-writable.
3. Terminate HTTPS in the reviewed reverse proxy and forward only to `127.0.0.1:4318`. Set `PROXY_HOPS=1` only for exactly one trusted proxy. The backend port must not be publicly reachable, and the proxy must overwrite untrusted forwarding headers. Check login, Secure/HttpOnly cookies, CSRF rejection, `/api/health`, private readiness and history over the real HTTPS origin.
4. Keep `LIVE_PAYMENTS_ENABLED=false` while checking the operator console. A healthy HTTP endpoint is liveness evidence only. Model, data and payment readiness remain separate authenticated checks. Do not add secrets to the public Vercel project.

When paid operation is explicitly authorized, use a private Compose override to mount the dedicated payer JSON read-only at `/run/secrets/payer.json`, set `PAYER_SECRET_FILE` to that path, and override the disabled flag only after completing [live setup](live-setup.md). The host file must be readable only by the service UID and designated operator. Keep `PAYER_SECRET_JSON` empty when mounting the file. Do not bake a signer into the image, put it on a command line, or mount a broad home directory. The base Compose configuration intentionally contains no payment key or live capability.

## Online backup

Use the supported SQLite backup API; copying the active `.sqlite` file can omit committed WAL pages. A backup includes sessions, grants, every financial identity, buyer replay data, merchant cached results, migration history and recovery locks. It contains sensitive private data, so use an ignored private directory and encrypted off-host retention.

Inside the running container:

```sh
docker compose exec allowance node dist/server/db/maintenance.js backup /data/allowance.sqlite /data/backups/release-2026-09-20
docker compose exec allowance node dist/server/db/maintenance.js validate /data/backups/release-2026-09-20
```

Create `/data/backups` as UID 1000 with mode 0700 first. Backup destinations must be new directories. The command produces a 0600 `journal.sqlite` and `manifest.json` containing checksum, UTC completion time, schema version and table counts. SQLite integrity and foreign-key validation are checked before success. The supported backup is a consistent snapshot, not proof that no later payment exists. Its SHA-256 detects accidental changes; it is not an authenticity signature against a compromised host.

For a local install, use `npm run db:maintenance -- backup var/allowance.sqlite var/backups/<new-name>` and the corresponding `validate` subcommand. Production images require no `tsx` or other development dependencies because `node dist/server/db/maintenance.js` is available.

## Restore without resurrecting spending authority

Stop the service and every local MCP process. Preserve the original complete volume, including any WAL/SHM files, for recovery. **Never restore over an existing database path.** Restore to a new filename and then deliberately point `DATABASE_PATH` (or the Compose override) at it.

```sh
node dist/server/db/maintenance.js restore /data/backups/release-2026-09-20 /data/restored.sqlite --lock-signing
```

The command verifies the backup, applies compatible migrations, removes copied service ownership and records a persistent recovery lock. Existing financial records, signatures, replay payloads, receipt results, sessions and grant records survive. Active runs become interrupted; old models do not restart. A later service startup releases only provably unsigned reservations and keeps potentially signed work held. Both the main service and shared local MCP adapter reject new spending while any restore lock is pending. Their read-only ownership heartbeat remains available.

Restart with signing disabled. Inspect original receipt IDs and reconcile the original signatures, message hashes, recipient, mint and amounts against trusted RPC/facilitator evidence. A missing result cannot free a hold. Compare the snapshot with the preserved newer journal, provider logs and the dedicated payer's complete post-backup history. A restored zero balance of holds cannot prove that omitted post-backup transactions never happened. If that history cannot be reconstructed, leave the lock closed; do not release it merely because a checklist was filled out.

Recovery release is an offline, explicit operator attestation. It does **not** perform or claim independent chain verification, transfer funds or authorize a run. It refuses active service ownership, unresolved local holds, unverified settled payments and ambiguous merchant submissions. Obtain actual missing original evidence first; never manually fabricate signatures or mark payments verified to satisfy it.

Prepare a private approval JSON only after that investigation:

```json
{
  "restorationId": "<id returned by restore>",
  "operator": "<accountable operator>",
  "reconciledThrough": "<current UTC timestamp after reconciliation>",
  "allPostBackupActivityAccountedFor": true,
  "originalPaymentIdentitiesPreserved": true,
  "soleAuthoritativeJournal": true,
  "notes": "<at least 40 characters identifying preserved journals and the actual reconciliation evidence>"
}
```

Stop all processes, then run:

```sh
node dist/server/db/maintenance.js approve-recovery /data/restored.sqlite /private/recovery-approval.json --confirm-reconciled-restore
```

The timestamp must cover the restored state through the last five minutes. The command permanently records the attestation, clears pending restore locks and revokes all restored external grants. The operator still needs to sign in and explicitly authorize a new run. It never renews an old allowance or makes a new signature. An operator with filesystem/SQL access can bypass application controls; this is a server-managed signer trust model, not onchain escrow or a cryptographic cap against a compromised host.

## Release, restart and rollback

Before deploying, make and validate a backup, retain the image/commit and confirm the volume mount. Build/check the candidate, stop the old instance, start the new image with signing disabled, verify authentication/readiness/history and inspect unresolved original payments. Enable only an already authorized capability; bounded funded smoke and model execution require their corresponding credentials and spending authorization. After any such run, refresh and restart, then compare the same receipt identities and exact totals.

SIGTERM/SIGINT immediately remove shared signing authority and stop owned active runs. Unsigned reservations are released; signing claims and submitted payments remain accounted for. HTTP requests, reconciliation and the runner have up to 30 seconds to finish persisting their original outcome before process termination. On a crash, another process waits for the 20-second ownership lease to expire. A stale process cannot sign or stop a replacement service's newly authorized runs. Sessions survive a normal restart until their configured expiry.

Schema version 3 adds the `restore_recoveries` table and its migration-history entry to version 2. The migration is transactional and does not rewrite historical policies, amounts, networks or receipt evidence. Version 1 journals first receive the existing version 2 external-agent migration. This release refuses a database with a schema version newer than 3; do not assume an older binary has the same refusal or recovery controls. Roll back code only to a release verified to support schema 3 and retain its financial and recovery controls, preserving the current complete journal and volume. If no compatible earlier release exists, keep signing disabled and fix forward. Never roll back the journal, remove replay rows, reset holds, edit signatures or downgrade the schema as an ordinary deployment rollback. A needed database restore follows the locked procedure above.

Behavioral evidence: `tests/backup.test.ts` covers committed WAL, original holds/identities, caches, sessions/grants, checksum failure, no-overwrite, restore fencing and deliberate release. `tests/runtime.test.ts` covers shutdown preservation, preflight isolation, initialization failure cleanup, stale-process fencing and a real second-process lease rejection. These are controlled tests; they do not establish funded settlement or a deployed persistent host.
