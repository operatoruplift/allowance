# Allowance

**Give your agent a budget.** A small, single-operator application for buying useful Solana data with exact x402 USDC payments on Solana, with spending decisions enforced outside the model.

**Short description:** Allowance gives an AI agent a fixed, human-approved budget to buy useful Solana data through exact x402 payments, with every decision and receipt visible.

**Full description:** Allowance is a developer console for bounded agent payments on Solana. An operator freezes a task, allowance, per-request cap, approved tools and expiry. A bounded agent can request the two first-party data tools—`wallet_snapshot` and `transaction_explain`—but application code keeps control of prices, recipients, mint, network, signing and the durable ledger. Receipts separate reserved funds, settlement evidence, chain verification and service delivery, including honest recovery when a signed request becomes ambiguous. The public site rehearses that workflow with exact fixtures; the persistent backend is required for real x402 execution. See the [complete product description](docs/product-description.md).

The public rehearsal works immediately without accounts, signing, paid HTTP requests, or model calls. Live execution requires explicit setup. **No real Allowance mainnet or devnet settlement is claimed in this delivery.** See the [integration matrix](docs/integration-status.md) and [current release evidence](docs/release-2026-09-20.md) for checks and remaining setup.

The public rehearsal is live at [allowanceonsolana.vercel.app](https://allowanceonsolana.vercel.app). The [Vercel deployment guide](docs/vercel.md) documents its separate static build. Live operator access and payments continue to require the persistent backend described below.

[Source on GitHub](https://github.com/operatoruplift/allowance) · [Brand kit](https://allowanceonsolana.vercel.app/brand) · [Download all brand assets](https://allowanceonsolana.vercel.app/brand/allowance-brand-kit.zip)

## Run

Node 22.19 or newer in the supported Node 22/24 lines, npm, and a writable local disk are required.

```sh
npm ci
npm run dev
```

Open [127.0.0.1:4318](http://127.0.0.1:4318). Development is **one command: `npm run dev`**. Express hosts Vite in development; there is no second backend to start.

For a local production build:

```sh
npm run build
npm start
```

Production startup is **`npm start`**; Express serves `dist/client` and runs the bounded background worker. The local HTTP origin is allowed only at the exact configured loopback origin. Hosted origins must use HTTPS, with Secure cookies. Set `APP_ORIGIN` to the real origin and configure only the actual trusted proxy hop count.

| Route         | Use                                                                           |
| ------------- | ----------------------------------------------------------------------------- |
| `/`           | Landing and interactive receipt preview                                       |
| `/demo`       | Isolated deterministic rehearsal, including empty, failure and ambiguous recovery fixtures |
| `/login`      | Single-operator password login                                                |
| `/app`        | Authenticated readiness checks and task/policy composer                       |
| `/runs/:id`   | Private durable run, report, JSON export, print view and stop                 |
| `/developers` | Tool descriptions and server-side client example                              |
| `/brand`      | Downloadable profiles, wallpapers, headers, social artwork and logos          |

## Operator and live setup

```sh
cp .env.example .env
npm run setup:operator
```

The terminal command hides password input and writes an Argon2id hash and random session secret into ignored `.env` with mode 0600. Restart the service after setup. It rotates the session secret, invalidating old sessions. No public registration exists. Authentication unconfigured means live APIs are closed.

See [live setup](docs/live-setup.md) for dedicated payer and recipient setup, network-specific SOL and native Circle USDC, required associated token accounts, pinned facilitator fee sponsor, and a repeatable data wallet. Mainnet is the default setup, with live payments disabled. Devnet remains an explicit testing option; existing receipts retain their original network. Configure `OPENAI_API_KEY` and an explicit `OPENAI_MODEL`. The example `gpt-5-mini` is listed in [official documentation](https://developers.openai.com/api/docs/models/gpt-5-mini); account access has not been tested. There is no fallback model ID.

```sh
npm run preflight
```

This checks configuration and networks without signing or model calls. It exits nonzero when readiness is incomplete. From the operator console, use **Check readiness** before starting a live agent run. The model has at most five calls by default, 1,200 generated tokens per call, 48,000 characters of accumulated input, four tool proposals, and three minutes per run. Automatic provider retries are disabled. OpenAI billing is **outside** the USDC merchant allowance.

For a separately authorized external agent, set `MCP_ENABLED=true`, create an authenticated external run, and launch the local stdio bridge with `MCP_GRANT_TOKEN` as described in [the MCP runbook](docs/mcp.md). The bridge is off by default and has no public HTTP endpoint.

The standalone opt-in integration check starts its own local merchant listener; stop `npm run dev` first. This command performs scripted real payments, independent of an autonomous model trace:

```sh
# Only after configuring and explicitly authorizing this real-USDC spend:
npm run smoke:mainnet -- --confirm-mainnet-spend

# Separate testing alternative: set PAYMENT_NETWORK=devnet first.
npm run smoke:devnet -- --confirm-devnet-spend
```

Each command rejects the wrong payment network and requires its explicit confirmation flag. Mainnet also requires `MAINNET_PAYMENTS_ACKNOWLEDGED=true`. Both require `LIVE_PAYMENTS_ENABLED=true`, all payment configuration, and `DEMO_WALLET` with at least two available transactions. The scripted two-purchase scenario spends up to 0.030000 USDC; its separate 0.020000 probe must be denied before signing. It buys the wallet snapshot and latest transaction facts, then performs a separately labeled policy probe. It writes genuine dated evidence only if executed. Running it without the flag exits without creating a signer or runtime. Do not retry uncertain payments with new IDs. No live payment command was authorized or executed during this implementation.

## Controls and recovery

- USDC is represented as bounded integer micro-units and decimal strings at the API boundary. `0.04` is exactly `40000`.
- An immutable policy binds budget, per-call maximum, tools, exact destination, recipient, selected network/mint, expiry and call limit. The shared UTC daily ceiling applies across runs. Outstanding holds count even when the day changes.
- SQLite `BEGIN IMMEDIATE` transactions reserve before signing. Unique purchase identity and canonical request hashes prevent repeated signing. Database failure denies new payments.
- The guarded signer checks the actual transaction and durably records a signing claim before invoking the key. Uncertain outcomes remain held and freeze the payer. A rejected or crashed signer after this boundary is conservatively uncertain.
- A successful facilitator response, chain verification and returned service result are separate evidence. Replayed purchased responses reuse the same signed identity and never require a new signature.
- Stop or expiry prevents new signatures. Already signed work can settle afterward. Restart restores receipts and reconciliation; it does **not** restart the old model authorization. A new run remains subject to the shared daily ceiling.

This is a **server-managed signer with application-enforced controls**. A compromised server can defeat those controls. There is no custom onchain budget program, smart-wallet claim, payment channel, or independent merchant adoption. Both initial merchants are first-party sample services.

## Tests

```sh
npm run check
npx playwright install chromium
npm run test:browser
```

`check` runs lint, TypeScript, controlled unit/integration tests, and the production build. Tests use deterministic adapters and isolated SQLite databases. They do not spend or call paid APIs. The HTTP payment test traverses the actual middleware with controlled facilitator/signing adapters. The opt-in smoke commands above are **separate funded checks**, not part of the automated suite. Browser screenshots and dated read-only findings are in `evidence/`.

## Docker and persistent disk

Use exactly one application instance and one persistent volume for SQLite, its WAL, sessions, purchase identities and merchant response cache. Never put the live backend on an ephemeral serverless filesystem.

```sh
docker build -t allowance .
docker volume create allowance-data
docker run --name allowance --restart unless-stopped \
  --env-file .env.docker \
  -e APP_ORIGIN=https://allowance.example \
  -e HOST=0.0.0.0 -e PROXY_HOPS=1 \
  -e DATABASE_PATH=/data/allowance.sqlite \
  -e PAYER_SECRET_FILE=/run/secrets/allowance-payer.json \
  -p 127.0.0.1:4318:4318 \
  --mount type=volume,src=allowance-data,dst=/data \
  --mount type=bind,src=/absolute/path/to/allowance-payer.json,dst=/run/secrets/allowance-payer.json,readonly \
  allowance
```

Place one HTTPS reverse proxy in front of the bound local port. `.env.docker` is ignored by git. Docker env files take literal values: omit the surrounding single quotes from the Argon2 hash generated in `.env` when copying it to `.env.docker`. Do not copy key files into the image. The image runs as the unprivileged `node` user; ensure that user can read the mounted dedicated key. For rehearsal-only hosting, omit the secret mount and leave live payments disabled.

Use the [supported backup and restore commands](docs/runtime-recovery.md) rather than copying an active SQLite file. Restores preserve original receipts, holds and replay identities and begin locked against new spending; offline recovery requires explicit operator review. Keep secrets and backups private. Do not run multiple replicas or share one payer across different journals. The schema migration version is recorded in `schema_migrations`; payment cache tables are created by the payment module.

## Project map and delivery

The red brand edition includes 26 compositions in full-size PNG and outlined SVG, a phone-friendly `/brand` library, and a complete ZIP. Use the library's **Open full-size image** action to save individual PNGs to a phone; browser downloads may go to Files. See [the brand guide](docs/brand.md) for colors, typography, dimensions and the local `npm run brand:generate` command.

`src` contains the original React UI; `shared` contains validated contracts and money handling. `server/auth`, `agent`, `policy`, `payments`, `merchant`, `data`, and `db` form one Express service. [Architecture](docs/architecture.md) explains trust boundaries; [the reusable example](examples/paid-tool.ts) demonstrates calling the guarded buyer outside the sample agent.

- [90-second demo script](docs/demo-script.md)
- [Product descriptions](docs/product-description.md)
- [Submission draft](docs/submission.md), pending live settlement evidence and final event rules
- [Verification report](docs/verification.md)
- [Integration evidence and blockers](docs/integration-status.md)
- [Complete configuration reference](docs/configuration.md)
- [Durable runtime, backup and recovery](docs/runtime-recovery.md)
- [Focused threat model](docs/threat-model.md)
- [Local external-agent MCP runbook](docs/mcp.md)
- [Future channel transport](docs/payment-channels.md), not a shipped feature
- [Brand assets and tokens](docs/brand.md)
- [Sources, SDK reuse and licenses](docs/sources.md)

Payment Channels and remote MCP are future adapters. The local stdio MCP bridge is implemented and uses the same application service, policy, ledger and receipts. Allowance is a working product name; trademark availability has not been assessed. Original application code and artwork use the MIT license. Third-party dependencies retain their own licenses.

## Seeker, Android and PWA

Allowance installs as a PWA and ships an Android WebView shell (`android/`) for the Solana Seeker and dApp Store, with Solana Mobile Wallet Adapter support where the app connects a wallet. Build, test and publishing steps: [docs/seeker-and-pwa.md](docs/seeker-and-pwa.md).
