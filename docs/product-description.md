# Allowance product description

## Short description

Allowance gives an AI agent a fixed, human-approved budget to buy useful Solana data through exact x402 payments, with every decision and receipt visible.

## Full description

Allowance is a single-operator developer console for bounded agent payments on Solana. An operator creates a frozen grant with a task, total allowance, per-request cap, approved tools and expiry. The agent can propose work, but application code owns the policy, catalog prices, merchant destination, token mint, payment network, signing boundary and durable ledger.

The shipped example has two first-party paid data tools: `wallet_snapshot` for a bounded wallet summary at `0.010000` devnet USDC and `transaction_explain` for factual details about one transaction at `0.020000` devnet USDC. In a live configuration, each request follows the exact x402 HTTP flow: a priced resource returns a challenge, the server reserves the amount before signing, the facilitator settles the payment, and the merchant validates and delivers the requested result.

Allowance keeps those stages separate in its receipt. Reserved, submitted, reported settlement, chain-verified settlement, unknown settlement and delivered or unavailable results are distinct states. An ambiguous signed request remains held until the original intent is reconciled; recovery never creates a second signature or invents delivery. The local stdio MCP bridge exposes the same guarded tools, run status, receipt and stop controls to an authorized external agent.

The public site is a deterministic rehearsal of this workflow. It demonstrates the exact `0.040000` allowance story, a separately labeled `0.020000` policy denial and an ambiguous-hold recovery fixture without signing, paid requests, model calls or onchain claims. Real devnet execution requires an explicitly configured persistent backend, operator credentials, funded test accounts, a trusted facilitator sponsor and a configured model when the built-in agent is used.

## Demo description

The 90-second rehearsal authorizes the boundary, runs the two useful fixture purchases, inspects the report and receipt, triggers a separate over-budget policy probe, then reconciles an ambiguous hold while explaining why x402 and Solana matter. See [demo-script.md](demo-script.md).
