# Allowance product description

Last updated: **30 September 2026**.

## Short description

Allowance gives AI agents human-approved USDC budgets to buy useful tools and pay approved recipients on Solana, with spending controls outside the model and a durable record of each decision.

## Full description

Allowance is a single-operator application for giving AI agents spending authority with clear limits. A human approves the budget, maximum payment, permitted tools or recipients, and expiry. The agent proposes work; application code checks the policy before the server-managed payer can sign. The limits are enforced by the application and its durable ledger, not by a custom onchain budget contract.

The x402 payment rail buys two first-party Solana data tools: `wallet_snapshot` provides a bounded wallet summary for `0.010000` USDC, and `transaction_explain` provides factual details about one transaction for `0.020000` USDC. Each purchase follows the exact x402 HTTP flow: the merchant returns a priced challenge, the server checks the frozen policy and reserves the amount before signing, and the facilitator handles settlement. The merchant validates the payment before delivering the result. Prices, destinations, token mint and network remain outside the model's control.

A second payment rail supports direct USDC transfers to allowlisted recipients. The operator authorizes a mandate with a total ceiling, per-request cap and expiry. Direct payments and x402 purchases share the daily spending ceiling and payer hold: an uncertain signed payment blocks new spending on both rails until recovery resolves it. Adding a recipient to an existing mandate requires an administrator's signature and a single-use approval. Direct payments have a separate enablement gate and do not require an x402 facilitator.

Durable receipts separate reserved funds, submission, reported settlement, independent chain verification and service delivery. An ambiguous signed request remains held until the original payment is reconciled; recovery does not authorize a second payment or invent a delivered result. Direct-payment receipts require chain evidence before reporting settlement. The optional bounded built-in agent uses the guarded data tools. The local stdio MCP bridge exposes the guarded services to external agents through scoped grants for either tool purchases or direct-payment mandates, with status, receipt and stop controls.

Versioned receipt exports connect each purchase to its original request, frozen policy and selected payment and data networks. New policies also preserve a version and hash of the approved tool catalog; changing that catalog requires a new authorization. Receipts include original message and independent chain-proof references when those were actually observed. Historical records retain their original amounts and networks, and unavailable evidence stays unavailable. These hashes describe recorded application data; they do not establish an onchain payment by themselves.

The public policy lab at `/lab` lets anyone adjust a budget, per-request cap, daily capacity and tool permissions, then save a plan showing which requests fit. It moves no funds, and its export is a planning document rather than an authorization or payment receipt. The separate `/demo` page retains labeled fixtures for inspecting purchase decisions, failure states and recovery. The installable PWA provides access to the public pages; an Android WebView shell is included, but native downloads and behavior on a Seeker or other Android device still require validation.

Mainnet is the default payment configuration; devnet remains available for testing, including the direct-payment funded-check procedure. Real spending is disabled until the relevant rail is explicitly enabled, and mainnet also requires the operator's mainnet acknowledgment. The persistent backend is implemented and packaged, but this delivery has no deployed persistent payment host or verified Allowance mainnet or devnet settlement. Activation requires a persistent host and durable volume, operator credentials, a dedicated funded payer and working RPC access. The x402 rail additionally needs the merchant's token account and a compatible facilitator with a pinned fee sponsor; direct transfers need payer SOL for fees and any recipient token-account creation. The built-in agent also needs model credentials. Neither a deployed public site nor a passing controlled test is proof of a funded payment.

## Demo description

Start with the policy-lab walkthrough: change the spending limits, see requests become allowed or blocked, and save the resulting plan. The separate 90-second `/demo` walkthrough covers the two fixture purchases, a policy denial and ambiguous-hold recovery with its fixture labels visible. Record a funded run only after the relevant setup and separately authorized payment checks succeed. See [demo-script.md](demo-script.md).
