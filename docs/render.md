# Persistent mainnet deployment on Render

The root [`render.yaml`](../render.yaml) provisions the existing complete Docker application: one Express process, one durable SQLite journal, operator authentication, the agent, and the merchant API under one HTTPS origin. It does not create or fund a payer. Signing and mainnet acknowledgement start disabled. Adding this file to GitHub does not provision a service or establish payment readiness.

## Initial deployment

1. Select the intended Render workspace and billing account. Review the paid Starter service and 1 GB disk before creating the Blueprint from `operatoruplift/allowance`. The configured region is Singapore; choose the intended region before creation. This application must remain one instance with one authoritative journal.
2. Generate an operator password hash privately with `npm run setup:operator` in a local source checkout. Provide only the resulting Argon2id `OPERATOR_PASSWORD_HASH` in Render's initial secret prompt. Keep the password in your password manager. Render generates `SESSION_SECRET` once; retain it across ordinary restarts. Neither value belongs in source control or Vercel.
3. Deploy the reviewed commit. The Blueprint uses the Dockerfile's complete build and start command. `APP_ORIGIN` references the service's assigned `RENDER_EXTERNAL_URL`; it is not a guessed hostname. The listener uses `0.0.0.0:10000`, and the journal lives at `/data/allowance.sqlite`.
4. Verify that the persistent mount is writable by the application's UID 1000. Do not make the journal world-writable or remove `USER node` to bypass a permission problem. Check `/api/health`, then operator sign-in, Secure/HttpOnly cookies, CSRF rejection, and private history over the actual HTTPS origin. `PROXY_HOPS=1` assumes the direct Render ingress path; re-evaluate it before adding another proxy.
5. Restart the same service and verify the session and journal survive. A successful health check proves process/database liveness only. Payment, data, and model readiness remain separate operator checks.

The Blueprint has automatic deploys disabled and no pull-request previews. Render stops a disk-backed instance before replacing it, so deployments have a brief interruption. Its 40-second shutdown allowance exceeds the application's 30-second drain window. After an abrupt termination, the database lease can require up to 20 seconds to expire before restart succeeds.

## Configure capabilities privately

Use Render's service environment or a private secret file. The initial Blueprint deliberately includes no signer, merchant, facilitator credential, or model credential.

| Setting | Required input |
| --- | --- |
| `PAYER_SECRET_FILE` or `PAYER_SECRET_JSON` | A dedicated low-balance 64-byte JSON keypair. Configure one source only. If using a Render secret file, use its verified absolute path, such as `/etc/secrets/payer.json`, and check readability by UID 1000. |
| `MERCHANT_RECIPIENT` | A separate token-owner address with an initialized native-USDC associated account. The payer also needs its associated account. |
| `PAYMENT_RPC_URL`, `DATA_RPC_URL` | Reviewed mainnet HTTPS RPC endpoints. The Blueprint supplies the public Solana endpoint; configure your production provider as needed. |
| `FACILITATOR_URL` | A reviewed provider advertising x402 v2 exact Solana mainnet with the intended sponsor. There is no trusted production facilitator default. |
| `FACILITATOR_TOKEN` | Optional bearer credential from that provider, if required. Other authentication schemes need a compatible adapter. |
| `TRUSTED_FEE_PAYER` | The separately reviewed sponsor address, pinned by the operator. Do not automatically trust an arbitrary provider response. |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | Provider credential and an explicit Responses-compatible model for the built-in agent. Model usage is billed separately. |
| `DAILY_USDC_CEILING`, `MAX_RUN_ALLOWANCE` | Reviewed spending limits. Initial values are 0.100000 and 0.040000 USDC. |

Readiness requires a payer balance of at least 0.010000 USDC. The documented two-purchase integration check consumes 0.030000 USDC; account creation is not included. The pinned sponsor pays bounded SOL transaction fees. Funding and an enabled service do not themselves create a run.

Keep `LIVE_PAYMENTS_ENABLED=false` until the host, credentials, accounts, funding, provider, and limits are reviewed. Mainnet operation requires both `LIVE_PAYMENTS_ENABLED=true` and `MAINNET_PAYMENTS_ACKNOWLEDGED=true`. The checked-in Blueprint intentionally keeps both false: a later Blueprint sync reapplies those safe values. Before ongoing paid operation, deliberately transfer these two settings to private dashboard management by removing their fixed-value entries from the Blueprint, or maintain a separately reviewed deployment configuration. Never put secret values into the YAML.

Render prompts for `sync: false` values only on initial Blueprint creation. Subsequent credential additions or rotations must use the service's private settings. Preserve the session secret unless deliberately invalidating operator sessions.

## Preflight and first run

Use **Check readiness** in the authenticated console, or run the compiled command in the live service shell:

```sh
npm run preflight
# Equivalent in the production image:
node dist/server/preflight.js
```

The command needs only production dependencies. In a fresh local source checkout, run `npm run build` first; `npx tsx scripts/preflight.ts` remains an optional development entry. Preflight returns nonzero when capabilities are incomplete. It performs provider/RPC reads, never signs, submits a payment, or calls the model, and does not acquire or release the running service's spending lease. Opening the configured journal may initialize compatible database schema, so use the configured durable path rather than an arbitrary temporary database.

For the deployed application, authorize a bounded run through the authenticated console after fresh readiness succeeds. The standalone `smoke:mainnet` command requires a local merchant origin and is not a hosted-service command. Retain actual signatures, independent verification, original receipt identities, and exact totals from any authorized paid run; refresh and restart before confirming persistence.

## Backups, upgrades, and origin changes

Use the [runtime/recovery runbook](runtime-recovery.md) and compiled `node dist/server/db/maintenance.js` commands in the live service shell. Render build commands, pre-deploy commands, and one-off jobs cannot access the persistent disk. Do not put database backup, migration, or restore commands in those hooks. Keep validated, encrypted off-host backups; do not treat disk snapshot rollback as a safe financial-journal recovery procedure.

The initial application uses its Render HTTPS origin for the browser, API, and merchant. If adding a custom domain, review and update the exact `APP_ORIGIN` mapping in the Blueprint and restart before using that domain. Existing policies bind their original origin, network, mint, and recipient; reconcile existing purchases under their original configuration before changing these boundaries.

The existing Vercel deployment does not provide this durable service. Keeping its hostname for the full application requires reviewed whole-app routing and proxy-header verification. A remote API URL alone does not supply same-origin authentication or turn the static build into the complete application. Do not upload server credentials to the Vercel project.

## References checked 23 September 2026

- [Render Blueprint specification](https://render.com/docs/blueprint-spec): Docker settings, secret prompts, generated secrets, service environment references, health path, shutdown delay, and manual deployment.
- [Render default environment variables](https://render.com/docs/environment-variables): assigned service URL and listener port.
- [Render persistent disks](https://render.com/docs/disks): one-instance disk access, runtime-only availability, and deployment interruption.
- [Render health checks](https://render.com/docs/health-checks): HTTP health behavior.
- [Allowance mainnet setup](live-setup.md) and [configuration reference](configuration.md): payment guardrails and the complete environment contract.
