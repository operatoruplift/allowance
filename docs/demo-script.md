# Product walkthrough scripts

Last updated: **30 September 2026**.

## Policy lab: a 60-second walkthrough

Start with `/lab`, reached from **Explore the policy lab** on the landing page. This is a working capacity planner, not a payment run. Keep **No funds moved** visible and describe the amounts as planned tool costs. The page recalculates immediately; there is no run button.

| Time | Screen/action | Narration |
| --- | --- | --- |
| 0:00–0:12 | Open `/lab`; show the three limits | “Give the task 0.040000 USDC, cap each request at 0.020000, and make 0.100000 available for the day.” |
| 0:12–0:25 | Show the initial three requests and totals | “A wallet snapshot costs 0.010000. A transaction explanation costs 0.020000. Those two fit; the next explanation exceeds the remaining allowance. Planned costs are 0.030000, leaving 0.010000.” |
| 0:25–0:37 | Change **Per-request cap** to `0.010000` | “The smaller cap blocks both explanations. Only the wallet snapshot fits, so planned costs fall to 0.010000. The requests are checked in order, and a blocked request consumes none of the allowance.” |
| 0:37–0:47 | Press **Reset limits and requests**, then uncheck **Transaction explanation** | “Permission is a separate boundary. A tool can be blocked even when its price fits the budget.” |
| 0:47–1:00 | Reset again, then press **Save policy plan** | “Save the plan to review its limits and decisions. No transaction was submitted. Running an agent requires an authenticated server policy and payment readiness.” |

The downloaded `allowance-policy-plan.json` identifies itself as `kind: "policy-plan"` with `paymentSubmitted: false`; amounts are integer micro-USDC strings. It contains no settlement signature and cannot authorize spending. The planner covers catalog tools only, not direct-payment mandates. SOL fees and model usage are separate from its USDC figures.

For a longer tour, lower **Daily capacity** to `0.020000`, add or remove requests, and enter an invalid amount to show the message next to its field. Reset before comparing results with the table. Record phone installation only on a device you actually tested; the Android shell does not yet provide a verified native file-download flow.

## Separate `/demo` route: 90-second fixture walkthrough

Use the **rehearsal script** until a genuine Allowance run has been recorded. Read-only RPC evidence and successful fixture tests are not settled purchase evidence. Put the recording date in the video and its description. Do not edit model decisions to fit this script.

| Time      | Screen/action                                      | Narration                                                                                                                                                                                     |
| --------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00–0:10 | Landing, then “Try the example”                    | “Allowance lets a developer give an agent a task and a spending ceiling. These two tools are our first-party sample merchants.” |
| 0:10–0:23 | `/demo`, visible rehearsal label                   | “This is a deterministic rehearsal. No signing, paid request or model call occurs. The allowance is 0.040000 example USDC on the mainnet preview, with a 0.020000 per-request cap.” |
| 0:23–0:40 | Wallet snapshot and transaction explanation events | “The example purchases a wallet snapshot for 0.010000 and an explanation for 0.020000. In live mode, both tools return validated Solana RPC facts over actual x402 HTTP endpoints.” |
| 0:40–0:53 | Amount breakdown and policy probe                  | “That leaves 0.010000. This separate policy probe proposes another 0.020000 purchase. The same guard denies it before signing and does not consume the allowance.” |
| 0:53–1:05 | Report, unsupported markers and receipt export     | “The report cites the returned facts and names limitations. Settled charges, held funds and service delivery are distinct. This rehearsal receipt deliberately has no transaction signature.” |
| 1:05–1:20 | Recovery scenario selector, then reconcile         | “This recovery example simulates a timeout after signing. The original amount stays held until reconciliation, which clears the hold without creating a second signature or inventing delivery.” |
| 1:20–1:30 | Return to the budget summary and closing             | “An agent can buy useful tools while you keep a clear spending boundary and understand every expenditure. Give your agent a budget.” |

Keep the rehearsal/no-payment label visible throughout. The current walkthrough and viewport/state evidence are linked from the [release manifest](../evidence/release-2026-09-20-manifest.json). Decorative films autoplay by default; the small Motion preference and system reduced-motion/data-saving preferences can show posters without delaying a run or accounting update.

Technical appendix, outside the 90-second product story: the live console needs a durable server, real operator authentication, a dedicated network-specific payer and merchant, reviewed provider/sponsor, initialized funded token accounts, and model access for built-in AI execution. See [integration status](integration-status.md). A scripted funded smoke, model-driven run, local MCP exchange and browser fixtures are distinct recordings; retain their actual labels.

## Replace only after a real live recording

Follow the network-specific setup and separately authorized smoke procedure in [live-setup.md](live-setup.md), and save its dated evidence. Mainnet requires an explicit mainnet spending authorization; the devnet smoke command must never be repurposed to spend mainnet funds. For the live video, show the actual data and payment network labels with `Live`, the actual run ID, two settled transactions and their network-correct explorer links. Demonstrate refresh recovery. Show the final separately labeled policy probe and verify there is no third payment. The final accounting should be 0.030000 settled, 0 held and 0.010000 remaining only if actual evidence supports it.

If the model legitimately skips the optional transaction, say so. If a payment is held/unknown or settled with result unavailable, preserve that status, explain recovery and do not claim a successful completed demo. Keep LLM charges and SOL fees/rent separate from the USDC tool allowance.

A public devnet sample with two useful transfer transactions was observed on 2026-09-12 (see [sources.md](sources.md)). Its history can change and it is not controlled by this project. For a repeatable live recording, prepare a dedicated test wallet with at least two known supported transfers using separately authorized devnet funding, then configure `DEMO_WALLET` to that address.
