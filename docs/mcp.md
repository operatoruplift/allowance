# Local external-agent bridge

Allowance exposes a local, stdio-only MCP adapter for an authenticated operator who wants an external agent to use the same guarded payment engine. It is disabled by default and is never part of the public rehearsal or the static Vercel build. The adapter does not expose a signer, arbitrary HTTP client, payment channel, or policy mutation tool.

## Enablement and authorization

Set `MCP_ENABLED=true` in the private backend environment. The operator must first create an external run through the authenticated API. The API returns the run receipt and one opaque grant token; keep that token in the local MCP client environment as `MCP_GRANT_TOKEN`. The token is stored only as a SHA-256 hash in SQLite, is bound to the authorizing session and run, expires with the frozen run policy, and is revoked on logout or stop. Never place it in a model prompt, browser bundle, repository, or public URL.

The external run route is:

```text
POST /api/external-runs
```

It accepts the same strict run body as `POST /api/runs` (`wallet`, `task`, `allowance`, `perRequestCap`, `expiresInMinutes`, and `allowedTools`). It requires operator authentication, a fresh successful readiness check, and live payment configuration for the selected network. It does not require an OpenAI key because the external agent is the runner. The response contains `run` and the one-time `grant.token`; no token is returned by receipt or status tools.

Start the bridge from the repository root only after the operator has created the run:

```sh
MCP_ENABLED=true MCP_GRANT_TOKEN='the-private-token' npm run mcp
```

The process speaks JSON-RPC on stdout and writes diagnostics only to stderr. It uses `createRuntime(..., { recover: false, exclusive: false, shared: true })` so connecting a client cannot restart or reactivate a run; paid mutations still require the already-running backend service lease. Keep the Express backend running while the bridge is connected. The bridge should be a child process of a local MCP client, not a publicly reachable HTTP service.

## Fixed tool contract

Every tool has a strict object schema. `runId` is a UUID. Paid calls also require a stable `requestId` of 16–128 URL-safe characters. The transaction signature is validated as a 64-byte base58 Solana signature. The wallet address is taken from the frozen run policy; an agent cannot substitute another address.

| Tool                  | Scope                 | Behavior                                                                                                                                |
| --------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `wallet_snapshot`     | `wallet_snapshot`     | Runs the fixed 0.010000 USDC wallet snapshot through the existing x402 buyer and ledger.                                         |
| `transaction_explain` | `transaction_explain` | Runs the fixed 0.020000 explanation only for a signature returned by a delivered snapshot in the same run.                              |
| `get_run_status`      | `get_run_status`      | Returns status, execution mode, bounded totals and safe purchase summaries.                                                             |
| `get_receipt`         | `get_receipt`         | Returns the durable policy, timeline, purchase evidence and delivered results for the run.                                              |
| `stop_run`            | `stop_run`            | Stops the run, releases unsigned reservations and revokes the grant. Submitted or uncertain payments remain visible for reconciliation. |

Paid calls always use `payments.runPaidTool`, so exact x402 challenge validation, canonical request binding, pre-sign policy checks, durable signing claims, replay recovery and settlement handling are shared with the built-in runner. There is no MCP path that invokes a signer directly.

Errors are returned as MCP `isError: true` results with stable codes such as `GRANT_INVALID`, `GRANT_EXPIRED`, `GRANT_REVOKED`, `GRANT_SCOPE_DENIED`, `POLICY_DENIED`, `PAYMENT_UNAVAILABLE`, `SETTLEMENT_UNKNOWN`, `DELIVERY_FAILED`, `DUPLICATE_REQUEST`, and `REQUEST_CONFLICT`. Provider, stack and secret details are not returned to the agent.

## Current blockers

The bridge is implemented and covered by controlled MCP discovery, schema, authorization, revocation, stop and error tests. It has not been used for a funded payment in this delivery. A live run still needs the exact prerequisites in [live-setup.md](live-setup.md): operator credentials, a dedicated payer on the selected network, a different merchant recipient with token accounts, network-specific SOL/USDC, a reviewed trusted fee sponsor, RPC/facilitator readiness, and a prepared wallet. No grant creation or MCP process start can verify a real onchain settlement by itself.
