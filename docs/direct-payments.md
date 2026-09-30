# Guarded direct payments (mandates)

Last updated: **28 September 2026**.

Allowance's first rail buys catalog tools over x402. This second rail lets an agent pay exact USDC amounts to recipients an operator listed in advance, with the same discipline: the policy is decided outside the model, every decision is a durable receipt, and the payer is held whenever a signed payment's outcome is uncertain. It ships behind its own operator gate and is devnet-first.

## What a mandate freezes

A **mandate** is created once by the authenticated operator and never edited:

| Field | Meaning |
| --- | --- |
| `perRequestCap` | The most one payment may move. |
| `ceiling` | The most the mandate may move in total (settled plus held). It cannot exceed `DAILY_USDC_CEILING`. |
| `expiresAt` | 1 minute to 24 hours after authorization. |
| `recipients` | 1 to 20 Solana addresses with labels. The payer can never be a recipient. |
| `network`, `mint`, `payer` | Captured from the running configuration: the network's native USDC and the dedicated payer. |

Recipients can be added later **only** with an administrator's signature (see below); nothing else about a mandate changes. Stopping a mandate releases unsigned reservations and revokes its grant.

## How a payment is decided

`decideDirectPayment` in `shared/mandate.ts` is pure and runs inside a `BEGIN IMMEDIATE` transaction. In order: network and mint must match the frozen mandate; the amount must be a whole number of micro-USDC above zero; the recipient must not be the payer and must be on the allowlist; the amount must fit the per-request cap; the mandate must be active and unexpired; the payer must not be held; the amount must fit the remaining ceiling; and the amount must fit the **shared daily ceiling**, which counts x402 purchases and direct payments together. A denied request is written as a receipt with a `reasonCode` such as `recipient-not-allowlisted` or `per-request-cap`; nothing is read from the chain and nothing is signed.

## What happens after "allowed"

1. Read preconditions from the payment RPC: genesis hash, the payer's USDC account and balance, whether the recipient already has a USDC account, the payer's SOL, and a recent blockhash.
2. Compose the exact transaction: compute budget, an idempotent create-associated-token-account instruction only when the recipient lacks one, a single `TransferChecked` of the approved amount with six decimals, and a memo naming the payment id.
3. Check the fee against `DIRECT_MAX_FEE_LAMPORTS` and simulate the unsigned transaction. A failure here releases the reservation; nothing was signed.
4. Re-run every policy check and durably claim signing (`signed_identity`). From this point the payment is held until chain evidence resolves it, exactly like an x402 purchase.
5. Sign, persist the signed bytes and signature, submit, and poll `getSignatureStatuses` up to about 25 seconds.
6. Prove settlement from `getTransaction`: same message bytes, same first signature, the payer's account down by exactly the amount, the recipient's up by exactly the amount, fee within the cap. Only then is the receipt `settled` with `chainVerified: true`, a slot and an Explorer link.

Outcomes that are not settlement are recorded honestly: `failed` when the transaction landed with an error (no USDC moved), `expired` when the blockhash lapsed and the signature never appeared, `settlement-unknown` when the network could not be asked. The background reconciler (every 30 seconds in the backend) re-broadcasts identical signed bytes while a blockhash is still valid and resolves held payments from chain state. A held payment on either rail blocks new payments on both.

## Setup on devnet

```sh
PAYMENT_NETWORK=devnet
PAYMENT_RPC_URL=https://api.devnet.solana.com
DIRECT_PAYMENTS_ENABLED=true
PAYER_SECRET_FILE=secrets/devnet-payer.json   # 64-byte JSON array, ignored by git
DAILY_USDC_CEILING=1.000000                   # bounds every mandate ceiling
ADMIN_PUBLIC_KEY=                              # optional, see approvals
```

Fund the payer with devnet SOL (for fees and, once per recipient, token-account rent) and devnet USDC from the Circle faucet, which creates the payer's USDC account. The `LIVE_PAYMENTS_ENABLED` x402 gate and the facilitator are not required for this rail. Then start the backend (`npm run dev` or `npm start`), sign in, run **Check readiness**, and authorize a mandate from the **Guarded payments** card. The response contains the mandate and a one-time grant token for an MCP client.

The MCP client runs the same bridge as the x402 tools:

```json
{
  "mcpServers": {
    "allowance": {
      "command": "node",
      "args": ["/absolute/path/to/allowance/dist/server/mcp.js"],
      "env": {
        "DOTENV_CONFIG_PATH": "/absolute/path/to/allowance/.env",
        "MCP_ENABLED": "true",
        "MCP_GRANT_TOKEN": "<token from POST /api/mandates>"
      }
    }
  }
}
```

Build first with `npm run build`; keep the backend running, because the bridge spends only while the backend holds the service lease. `DOTENV_CONFIG_PATH` points the bridge at the same private `.env` as the backend so both read the same journal and payer. Never put the grant token in a prompt, a repository or shell history.

## Tools

| Tool | Behavior |
| --- | --- |
| `get_mandate` | Frozen limits, recipients and remaining budget. |
| `execute_guarded_payment` | `mandateId`, stable `requestId`, `recipient`, decimal `amount`, optional `memo`. Returns a verdict of `RESERVED`, `SETTLED`, `SUBMITTED`, `UNKNOWN` or `NOT_SETTLED` with the receipt and Explorer link, or an `isError` result with verdict `BLOCKED` and the `reasonCode`. |
| `list_direct_payments` | Every receipt and event under the mandate. |
| `add_recipient_to_allowlist` | Adds one recipient with a verified administrator signature and single-use nonce. |
| `stop_mandate` | Stops the mandate and revokes the grant. |

The same operations exist on the operator API: `POST /api/mandates`, `GET /api/mandates`, `GET /api/mandates/:id`, `POST /api/mandates/:id/payments`, `POST /api/mandates/:id/recipients`, `POST /api/mandates/:id/stop`, `POST /api/mandates/:id/reconcile`, `GET /api/mandates/:id/export`. Operator-initiated payments are recorded with `source: "operator"`.

## Administrator approvals

When `ADMIN_PUBLIC_KEY` is set, a recipient can be added to an active mandate by signing this exact UTF-8 text with that key (a plain Ed25519 message signature, the kind a wallet's "sign message" produces):

```text
Allowance recipient approval v1
mandate: <mandate id>
recipient: <address>
label: <label>
nonce: <16 to 64 URL-safe characters>
expires: <ISO 8601 time, at most 24 hours ahead>
```

`npm run approve:recipient -- --mandate <id> --recipient <address> --label "Vendor" --key secrets/admin.json` signs it with a local keypair file and prints the JSON body. The server checks the signer is the configured administrator, the expiry is in the future and within a day, the signature verifies, and the nonce has never been used; the nonce is consumed in the same transaction that inserts the recipient.

## Verification

- `npm test -- tests/mandate-policy.test.ts tests/mandate-ledger.test.ts tests/direct-service.test.ts tests/mcp-mandate.test.ts tests/mandate-api.test.ts`: the decision table, ledger holds and recovery, the full transfer lifecycle against a deterministic chain double that decodes and applies the real signed bytes, the MCP tools including grant revocation and administrator approvals, and the operator API.
- `npm run smoke:direct-devnet -- --confirm-devnet-spend`: the funded proof. It authorizes a ten-minute mandate, records one blocked probe to an unlisted address, moves 0.010000 devnet USDC to a fresh recipient, waits for settlement and writes `evidence/direct-devnet-smoke-<time>.json` with the Explorer link. It needs the devnet setup above; it is never part of `npm test`.

## Limits

This rail moves funds the payer holds; there is no onchain escrow, so a compromised host or stolen payer key bypasses the application policy. Keep the payer small and dedicated, keep one funded payer per journal, and treat mainnet as a separate, explicitly acknowledged decision (`MAINNET_PAYMENTS_ACKNOWLEDGED=true`). Ledger-signed evidence, wallet-signed approvals from hardware wallets that require off-chain message framing, and remote MCP transports are out of scope for this release.
