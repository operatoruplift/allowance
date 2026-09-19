# Live mainnet setup

The public Vercel site is a deterministic rehearsal. It has no signer, model, payment RPC or facilitator access. A persistent Allowance server supports exact USDC payments on Solana mainnet and explicitly selected devnet. Mainnet is the new-configuration default; **live payments are disabled by default**. Mainnet support is implemented and covered by controlled HTTP/SDK/chain-proof tests. No real mainnet settlement or funded end-to-end agent run was performed during this implementation.

## Operator and hosting

Use the [configuration reference](configuration.md) for every variable's shape, origin and boundary, and the [runtime/recovery runbook](runtime-recovery.md) for the deployable single-instance artifact, backup, restore lock and rollback. The [integration matrix](integration-status.md) separates current controlled evidence from the unresolved funded gate.

Use Node 22.19–24 on a persistent server with one active Allowance service and a durable writable SQLite volume. Static Vercel deployment does not supply that runtime. Copy `.env.example` to ignored `.env`, run `npm run setup:operator`, and configure HTTPS `APP_ORIGIN`, persistent `DATABASE_PATH` and the correct `PROXY_HOPS` for the host. Keep the API and merchant under the same reviewed origin. The process lease denies spending when a second owner or failed lease could compromise the journal.

The environment file must never be committed. The browser receives no secret material. Run `npm run dev` locally or `npm run build && npm start` on the persistent host. Authentication uses the configured Argon2id operator hash, persistent sessions and CSRF protection.

## Mainnet payment configuration

1. Set `PAYMENT_NETWORK=mainnet` and an explicit HTTPS `PAYMENT_RPC_URL`. The official public endpoint is `https://api.mainnet-beta.solana.com`; a production deployment should use its configured RPC provider. Preflight and the final pre-sign check verify the full genesis hash, independently of the URL label.
2. Create a dedicated low-balance payer and supply its 64-byte JSON keypair through ignored `PAYER_SECRET_FILE` or backend-only `PAYER_SECRET_JSON`. Set `MERCHANT_RECIPIENT` to a different token owner. Both need initialized associated accounts for native Circle USDC; this application does not create accounts. Fund the payer with real USDC only for an explicitly intended run. The reviewed sponsor pays transaction SOL fees; this implementation requires sponsorship, so payer SOL is reported rather than used as an invented funding threshold.
3. Select and set `FACILITATOR_URL` explicitly. Its `/supported` response must advertise x402 v2 `exact`, the selected Solana CAIP-2 network and your reviewed sponsor. Set `TRUSTED_FEE_PAYER` to that sponsor; never automatically trust the first returned address. If the provider uses bearer authentication, configure `FACILITATOR_TOKEN`. Providers that require a different authentication mechanism need a compatible gateway/client; do not assume the public test facilitator supports production mainnet.
4. Set `DAILY_USDC_CEILING` and `MAX_RUN_ALLOWANCE`; defaults are 0.100000 daily and 0.040000 per run. Each policy permanently records network, mint, recipient, origin, limits and expiry. The model cannot change them. Signing accepts the exact approved transfer, associated accounts, memo, sponsor and bounded SOL fee.
5. After reviewing this configuration, set `MAINNET_PAYMENTS_ACKNOWLEDGED=true` and `LIVE_PAYMENTS_ENABLED=true`. Startup refuses live mode without explicit network, RPC and facilitator settings; mainnet also requires the acknowledgement. `npm run preflight` performs reads only and reports readiness. It never signs, settles or calls a model.
6. Set backend-only `OPENAI_API_KEY` and an explicit Responses API `OPENAI_MODEL` for the built-in bounded agent. Provider usage is billed separately from the USDC allowance. Authenticated external-agent grants require `MCP_ENABLED=true` but do not require the built-in model.

Canonical network values are fixed in `shared/domain.ts`: mainnet `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`, native USDC `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`, six decimals. These match the [official x402 exact SVM specification](https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_svm.md) and [Circle USDC contract addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses), checked 19 September 2026. A supported response is compatibility evidence, not payment proof.

## Read-only Solana data

New configuration defaults data to the selected payment network. `.env.example` explicitly uses `DATA_NETWORK=mainnet`, `DATA_RPC_URL=https://api.mainnet-beta.solana.com`, `ALLOW_MAINNET_READ_ONLY=true`. Mainnet reads require that separate opt-in. An unconfigured server can start, but its mainnet data client rejects requests before network access. Data and payment networks remain separate in policies, receipts and the interface. Empty or unavailable wallet history must never be replaced with invented activity.

## Guarded smoke commands

Stop the local app first because the standalone smoke command owns its merchant listener. With reviewed funded configuration and a prepared `DEMO_WALLET` containing at least two supported signatures:

- Mainnet: `npm run smoke:mainnet -- --confirm-mainnet-spend`
- Devnet: `npm run smoke:devnet -- --confirm-devnet-spend`

Each command checks the matching configured payment network, live opt-in and preflight. The mainnet command additionally inherits the real-money acknowledgement gate. The scenario makes two scripted purchases (0.010000 and 0.020000 USDC), then records a separate rejected 0.020000 policy probe. It does not call the model. Receipt evidence is saved under `evidence/<network>-smoke-<timestamp>.json`; success requires two delivered purchases with independent chain verification. A failed scenario retains its journal and payment holds. Rerunning with a new run authorizes new spending; it is not recovery of a prior payment.

## Existing devnet installations and recovery

Retain explicit `PAYMENT_NETWORK=devnet` and the matching devnet RPC when using test funds. Use Circle's [test-token faucet](https://faucet.circle.com/) for test USDC only, and review the facilitator's devnet support. No faucet or funded smoke was used for this implementation.

Existing stored policies and receipts are never migrated to mainnet. Reading a devnet record continues to return `paymentNetwork=devnet`. Changing runtime network, recipient or origin blocks signing or replaying that old purchase. Historical holds remain visible and conservatively block new spending; restore the original reviewed configuration to reconcile. Recovery compares the saved policy, original challenge and signed payload; it never makes a replacement payment. Switching live mode off disables paid recovery submission while allowing read-only observation of original proof and already-cached results. A restore lock likewise permits observation without paid transmission. Read-only misses do not consume the bounded four-attempt transmission budget; late evidence remains observable after that cap.

## What remains deployment-specific

Live operation needs a persistent host, operator hash/session secret, dedicated payer source, initialized/funded USDC accounts, a separate merchant recipient, explicit RPC and compatible facilitator access, a pinned fee sponsor, and model credentials for built-in AI runs. These are configuration and funding requirements, not evidence of an executed transaction. The production rehearsal remains usable without any of them.
