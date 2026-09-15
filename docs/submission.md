# Submission draft — Allowance

**Status: implemented application and deployed public rehearsal; genuine end-to-end Allowance devnet payment evidence pending. Do not submit this draft as a completed working payment demonstration yet.**

## Event check

The [Agentic Payments hackathon page](https://hackathons.solana.com/hackathons/agentic-payments-mtxd9fkr) was read on **2026-09-12**. A direct HTTP GET returned 200. The page described an event seeking sponsor funding and indicated scheduling follows its funding target. It did not expose launch/submission dates or detailed eligibility, judging or submission rules. Recheck those rules before submission. No deadline from another event is used. No registration or submission was performed.

## Project description

**Short description:** Allowance gives an AI agent a fixed, human-approved budget to buy useful Solana data through exact x402 payments, with every decision and receipt visible.

**Full description:** Allowance is a small developer console for purchasing useful Solana wallet information through x402 without handing an agent an unrestricted wallet. An operator freezes a task, spending ceiling, per-request maximum, expiry and approved tools. A bounded agent proposes tool calls; application code validates requests and reserves funds before the backend signer can act. Receipts make authorization, holds, settlement evidence, chain proof and service delivery readable, including conservative recovery when a signed request becomes ambiguous.

The initial workflow summarizes a wallet, explains its latest transaction and considers a second explanation if the budget permits. Our two first-party sample APIs provide a 0.010000 devnet USDC wallet snapshot and a 0.020000 transaction explanation grounded in validated RPC data. They are demonstration merchants, not independent merchant adoption. The local stdio MCP bridge exposes the same guarded service to an authorized external agent.

The central example authorizes 0.040000, accounts for 0.030000 in two purchases, then rejects a separately labeled 0.020000 policy probe with 0.010000 left. The always-available rehearsal demonstrates this with deterministic fixtures. A real agent trace is retained as observed and may skip the unaffordable purchase itself.

## Technical contribution

Original work includes the Allowance interface and SVG identity; application spending policy, durable request/receipt design and recovery workflow; bounded agent integration; first-party data tools; and the integration/test harness. We reuse official x402 exact SVM implementations and Solana signing libraries, plus maintained application, session, password-hashing and SQLite libraries. See [sources.md](sources.md) and `package-lock.json`.

The design separates authorization, held reservation, submission uncertainty, settlement and delivered data. It confines the signer to the backend, provides no public live-spending path, and keeps USDC merchant charges separate from LLM-provider costs and SOL fees/rent. It is a server-managed development signer with application-enforced limits, not a non-custodial smart wallet or onchain budget system.

## Evidence to attach

- Public deterministic rehearsal: [allowanceonsolana.vercel.app](https://allowanceonsolana.vercel.app), deployed September 12, 2026. This site makes no model calls or real payments.
- Repository: [operatoruplift/allowance](https://github.com/operatoruplift/allowance), including application code, controlled tests, brand kit and setup instructions.
- Recording URL and date: **pending**; use [demo-script.md](demo-script.md).
- Local checks and screenshots: see the repository verification report and screenshot artifacts.
- Real data reads: dated devnet genesis/mint verification and public wallet history are recorded in [sources.md](sources.md).
- Actual Allowance x402 settlements, receipt IDs and chain-verified token movements: **pending an authorized, funded live run**.

Deployment requires one persistent Node/Express service, SQLite on persistent disk and one app instance. `/demo` works without accounts or credentials. Live execution additionally requires the operator credentials, dedicated devnet signer, a separate merchant recipient, verified existing token accounts, pinned facilitator fee sponsor and a configured OpenAI model/API key. See [live-setup.md](live-setup.md).

Payment Channels and remote MCP are future adapters. The local stdio MCP bridge is implemented and covered by the controlled test suite. No user, revenue, volume, uptime, saved-fee, market-adoption or production-security claims are made.
