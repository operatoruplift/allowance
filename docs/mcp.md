# Local external-agent bridge

Last updated: **28 September 2026**.

Allowance exposes a local, stdio-only MCP adapter for an authenticated operator who wants an external agent to use the same guarded payment engine. It is disabled by default and is never part of the public rehearsal or the static Vercel build. The adapter exposes no arbitrary HTTP client, payment channel or policy-editing tool. Its x402 tools never invoke a signer. Since 28 September 2026 it also carries the [mandate tools](direct-payments.md): `execute_guarded_payment` does move USDC, but only after the frozen mandate policy has allowed the exact request, and only through the same durable claim-sign-prove sequence the x402 rail uses. The one policy mutation that exists, adding a recipient, requires an administrator's signature.

## Enablement and authorization

Set `MCP_ENABLED=true` in the private backend environment. The operator must first create an external run through the authenticated API. The API returns the run receipt and one opaque grant token; keep that token in the local MCP client environment as `MCP_GRANT_TOKEN`. The token is stored only as a SHA-256 hash in SQLite, is bound to the authorizing session and run, expires with the frozen run policy, and is revoked on logout or stop. Never place it in a model prompt, browser bundle, repository, or public URL.

The external run route is:

```text
POST /api/external-runs
```

It accepts the same strict run body as `POST /api/runs` (`wallet`, `task`, `allowance`, `perRequestCap`, `expiresInMinutes`, and `allowedTools`). It requires operator authentication, a fresh successful readiness check, and live payment configuration for the selected network. It does not require an OpenAI key because the external agent is the runner. The response contains `run` and the one-time `grant.token`; no token is returned by receipt or status tools.

Each external run has exactly one human-issued grant. Issuance checks and inserts that grant in one immediate SQLite transaction. An expired, revoked or lost grant cannot be replaced or reissued for the same run; the operator must explicitly authorize a new run. If a legacy journal contains multiple grant rows for one run, paid reservation and pre-sign authorization reject that ambiguity even when only one grant remains active. Historical rows are retained rather than silently selecting a replacement authority.

Set `MCP_ENABLED=true` and the grant in the MCP client's private environment settings, then start the bridge from the repository root only after the operator has created the run. Do not put the actual token in a shell command/history. Use npm's silent mode so its script banner cannot contaminate protocol stdout:

```sh
npm run --silent mcp
```

The process speaks JSON-RPC on stdout and writes diagnostics only to stderr. It uses `createRuntime(..., { recover: false, exclusive: false, shared: true })` so connecting a client cannot restart or reactivate a run; paid mutations still require the already-running backend service lease. Keep the Express backend running while the bridge is connected. The bridge should be a child process of a local MCP client, not a publicly reachable HTTP service.

The production equivalent is `node dist/server/mcp.js` with the same private environment and authoritative journal. Session existence, operator identity and expiry are checked for read tools as well as mutations; the grant is checked again before new signing, so logout during a slow upstream request cannot authorize a late signature. Restored journals remain blocked by the [recovery lock](runtime-recovery.md), and losing backend ownership denies new work. Recovery observes original payments without renewing grants or restarting the external model.

## Fixed tool contract

Every tool has a strict object schema. `runId` is a UUID. Paid calls also require a stable `requestId` of 16–128 URL-safe characters. The transaction signature is validated as a 64-byte base58 Solana signature. The wallet address is taken from the frozen run policy; an agent cannot substitute another address.

| Tool                  | Scope                 | Behavior                                                                                                                                |
| --------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `wallet_snapshot`     | `wallet_snapshot`     | Runs the fixed 0.010000 USDC wallet snapshot through the existing x402 buyer and ledger.                                         |
| `transaction_explain` | `transaction_explain` | Runs the fixed 0.020000 explanation only for a signature returned by a delivered snapshot in the same run.                              |
| `get_run_status`      | `get_run_status`      | Returns status, execution mode, bounded totals and safe purchase summaries.                                                             |
| `get_receipt`         | `get_receipt`         | Returns the durable policy, timeline, purchase evidence and delivered results for the run.                                              |
| `stop_run`            | `stop_run`            | Stops the run, releases unsigned reservations and revokes the grant. Submitted or uncertain payments remain visible for reconciliation. |

Paid x402 calls always use `payments.runPaidTool`, so exact x402 challenge validation, canonical request binding, pre-sign policy checks, durable signing claims, replay recovery and settlement handling are shared with the built-in runner. No x402 tool invokes a signer directly.

### Mandate tools

A mandate grant comes from `POST /api/mandates` (operator authentication, a fresh readiness check with `DIRECT_PAYMENTS_ENABLED=true`). It is stored and revoked exactly like a run grant and authorizes only the mandate it was issued for; a run grant cannot call mandate tools and a mandate grant cannot call x402 tools.

| Tool                         | Scope                        | Behavior                                                                                                                         |
| ---------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `get_mandate`                | `get_mandate`                | Frozen caps, expiry, recipients and remaining budget.                                                                            |
| `execute_guarded_payment`    | `execute_guarded_payment`    | Policy first; a blocked request is a durable `BLOCKED` receipt with its `reasonCode`. An allowed one is signed, submitted and proven from chain evidence, returning `SETTLED`, `SUBMITTED`, `UNKNOWN` or `NOT_SETTLED` with the Explorer link. |
| `list_direct_payments`       | `list_direct_payments`       | Every receipt and event under the mandate.                                                                                        |
| `add_recipient_to_allowlist` | `add_recipient_to_allowlist` | Adds one recipient with a verified administrator signature over the exact approval text and a single-use nonce.                  |
| `stop_mandate`               | `stop_mandate`               | Stops the mandate, releases unsigned reservations and revokes the grant.                                                          |

The grant is checked again inside the signing claim, so a logout during a slow chain read cannot authorize a late signature. A held payment on either rail blocks new payments on both, and the shared daily ceiling counts both rails.

Errors are returned as MCP `isError: true` results with stable codes such as `GRANT_INVALID`, `GRANT_EXPIRED`, `GRANT_REVOKED`, `GRANT_SCOPE_DENIED`, `POLICY_DENIED`, `APPROVAL_REJECTED`, `PAYMENT_UNAVAILABLE`, `SETTLEMENT_UNKNOWN`, `DELIVERY_FAILED`, `DUPLICATE_REQUEST`, and `REQUEST_CONFLICT`. Provider, stack and secret details are not returned to the agent.

## Current blockers

The bridge is implemented and covered by controlled MCP discovery, schema, authorization, revocation, stop and error tests, and the mandate tools by the direct-rail suites against a deterministic chain double. It has not been used for a funded payment in this delivery; the funded devnet proof for the mandate rail is `npm run smoke:direct-devnet -- --confirm-devnet-spend`, described in [direct-payments.md](direct-payments.md). A live run still needs the exact prerequisites in [live-setup.md](live-setup.md): operator credentials, a dedicated payer on the selected network, a different merchant recipient with token accounts, network-specific SOL/USDC, a reviewed trusted fee sponsor, RPC/facilitator readiness, and a prepared wallet. No grant creation or MCP process start can verify a real onchain settlement by itself.
