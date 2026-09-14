# Live devnet setup

The default rehearsal needs no secrets, funds, model calls or live payments. Live operation is an explicit operator choice. **A genuine end-to-end Allowance devnet purchase was not performed during the initial build.** Read-only public RPC and facilitator-support checks are separately recorded in [sources.md](sources.md).

## Configure one local operator

From the repository root, copy `.env.example` to ignored `.env`, run `npm run setup:operator`, and use the generated password hash/session configuration. The command must not print the password. Start locally with `npm run dev`; production uses `npm run build` followed by `npm start`. Use the Docker volume instructions in the README for persistence.

Set `APP_ORIGIN` to the exact browser origin. Hosted mode requires HTTPS, secure cookies and a correctly configured trusted reverse-proxy hop count. Keep one server instance and persist the SQLite directory. Public demo access never authorizes live purchases.

## Explicit live prerequisites

1. Create a **dedicated low-balance Solana devnet payer** in an ignored `secrets/devnet-payer.json` file and point `PAYER_SECRET_FILE` to it. Alternatively, set `PAYER_SECRET_JSON` in the backend environment. Never use a main-wallet seed, browser variable, browser storage or a committed file.
2. Configure `MERCHANT_RECIPIENT` to a **different** address. Only its public address is required. Obtain devnet USDC from [Circle's test-token faucet](https://faucet.circle.com/) and any required devnet SOL from an official Solana test faucet. This task did not request funds or use either faucet.
3. Make sure payer and merchant receiving associated token accounts already exist for mint `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`. The selected fee sponsor pays transaction fees under the exact-SVM contract; do not assume it will create token accounts. Creating/funding these accounts is a separately authorized setup action and can require test SOL/rent.
4. Keep `PAYMENT_NETWORK=devnet` and configure `PAYMENT_RPC_URL`. Set `FACILITATOR_URL=https://x402.org/facilitator` unless you have independently verified another documented compatible devnet facilitator. If a selected service requires credentials, set `FACILITATOR_TOKEN` server-side.
5. Inspect the facilitator's `/supported` response and explicitly set `TRUSTED_FEE_PAYER` to its reviewed devnet sponsor. The historical value in `sources.md` is evidence, not an automatic trust decision. Readiness must validate network, exact scheme, mint/decimals, recipient, sponsor, available funds and required token accounts before live execution.
6. Configure backend-only `OPENAI_API_KEY` and an explicitly selected documented `OPENAI_MODEL` available to that account. The checked example is `gpt-5-mini`; the application does not silently invent a fallback. `LLM_MAX_CALLS` and `LLM_MAX_OUTPUT_TOKENS` cap conventional provider usage, which is billed separately from the USDC allowance.
7. Set `DAILY_USDC_CEILING`, `MAX_RUN_ALLOWANCE` and a prepared `DEMO_WALLET`. For the central scenario use a 0.040000 run allowance, 0.020000 per-request cap, at least 0.030000 available test USDC, two permitted tools, and a fresh policy expiry. Allow a modest test SOL reserve for setup and any payer-funded fees; do not use unbounded priority fees.
8. Set `LIVE_PAYMENTS_ENABLED=true` only after reviewing this setup. Run `npm run preflight`. A successful support response is not a successful settlement; treat every failed/missing readiness item as unavailable.

## External agent mode

External agents use the local stdio bridge documented in [mcp.md](mcp.md). Keep `MCP_ENABLED=false` until the operator is ready to authorize a particular run. After a fresh readiness check, create `POST /api/external-runs` from the authenticated operator session, pass its one-time grant token to a local `npm run mcp` child process, and keep the token private. This mode bypasses the built-in OpenAI runner but retains the same exact catalog, ledger reservations, guarded signer, replay identity and reconciliation. Logout, stop, expiry and session loss revoke the grant. Creating a grant is authorization for that frozen run; it is not evidence of a payment or settlement.

Payment fees, rent and LLM costs are outside the tool-price total. Devnet tokens have no monetary value; no real funds are needed for this demonstration. A server-managed development signer and application limits do not protect against a fully compromised server.

## Data configuration

Default: `DATA_NETWORK=devnet`, `DATA_RPC_URL=https://api.devnet.solana.com`, `ALLOW_MAINNET_READ_ONLY=false`. To intentionally inspect mainnet data, set `DATA_NETWORK=mainnet`, configure a mainnet read-only RPC URL and set `ALLOW_MAINNET_READ_ONLY=true`. Keep payments devnet and label the UI `Data: mainnet · Payments: devnet`. Genesis verification catches accidental RPC/network mismatches.

For repeatable demonstrations prepare your own devnet wallet with at least two known supported transfers. The dated public sample in `sources.md` is available for read-only experimentation but its recent history is outside this project's control. An empty wallet is valid and must not be replaced with invented history.

## Opt-in smoke and evidence

Stop the local app first because the standalone smoke command owns its merchant listener. Run `npm run smoke:devnet -- --confirm-devnet-spend` only after explicitly enabling/funding the dedicated devnet configuration. The command retains one logical request identity across response-loss recovery; rerunning with a new run is a new spending authorization, not a retry of an old purchase.

Preserve the dated run/receipt output. A completed central payment demonstration needs two **actual settled** charges of 10000 and 20000 micro-USDC, trusted RPC token-movement evidence, 10000 remaining, and a separately identified 20000 policy probe denied before signing. Save the two real signatures and network-correct explorer links. Do not attach signature-like fixture values or present unrelated public transactions as settlement evidence.

If submission is uncertain, the reservation stays held and further payer spending is blocked until reconciliation. Stop prevents new signing but cannot reverse a submitted transaction. A settled payment with a failed response is a delivery failure with an existing charge; it is not a free retry or an automatic refund.

Missing initial configuration: operator hash/session secret, dedicated devnet payer and test funding, merchant recipient and required token accounts, explicitly trusted fee payer, provider API key/model access and a controlled prepared demo wallet. See readiness for the exact current deployment state. Do not publish, register or submit the hackathon entry as part of setup.
