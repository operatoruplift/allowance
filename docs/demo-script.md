# 90-second demo script

Use the **rehearsal script** until a genuine Allowance devnet run has been recorded. Read-only RPC evidence and successful fixture tests are not settled purchase evidence. Put the recording date in the video and its description. Do not edit model decisions to fit this script.

| Time      | Screen/action                                      | Narration                                                                                                                                                                                     |
| --------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00–0:10 | Landing, then “Try the example”                    | “Allowance lets a developer give an agent a task and a spending ceiling. These two tools are our first-party sample merchants.” |
| 0:10–0:23 | `/demo`, visible rehearsal label                   | “This is a deterministic rehearsal. No signing, paid request or model call occurs. The allowance is 0.040000 devnet USDC, with a 0.020000 per-request cap.” |
| 0:23–0:40 | Wallet snapshot and transaction explanation events | “The example purchases a wallet snapshot for 0.010000 and an explanation for 0.020000. In live mode, both tools return validated Solana RPC facts over actual x402 HTTP endpoints.” |
| 0:40–0:53 | Amount breakdown and policy probe                  | “That leaves 0.010000. This separate policy probe proposes another 0.020000 purchase. The same guard denies it before signing and does not consume the allowance.” |
| 0:53–1:05 | Report, unsupported markers and receipt export     | “The report cites the returned facts and names limitations. Settled charges, held funds and service delivery are distinct. This rehearsal receipt deliberately has no transaction signature.” |
| 1:05–1:20 | Recovery scenario selector, then reconcile         | “The recovery fixture times out after signing. The original amount stays held until reconciliation, which clears the hold without creating a second signature or inventing delivery.” |
| 1:20–1:30 | Operator readiness and closing                      | “The live path requires operator login, a dedicated devnet signer, a trusted facilitator, funded token accounts and a configured model. The source includes recovery tests and an exact-payment wrapper.” |

## Replace only after a real live recording

Run the opt-in smoke command in [live-setup.md](live-setup.md), and save its dated evidence. For the live video, show `Data: devnet · Payments: devnet · Live`, the actual run ID, two settled transactions and their network-correct explorer links. Demonstrate refresh recovery. Show the final separately labeled policy probe and verify there is no third payment. The final accounting should be 0.030000 settled, 0 held and 0.010000 remaining only if actual evidence supports it.

If the model legitimately skips the optional transaction, say so. If a payment is held/unknown or settled with result unavailable, preserve that status, explain recovery and do not claim a successful completed demo. Keep LLM charges and SOL fees/rent separate from the USDC tool allowance.

A public devnet sample with two useful transfer transactions was observed on 2026-09-12 (see [sources.md](sources.md)). Its history can change and it is not controlled by this project. For a repeatable live recording, prepare a dedicated test wallet with at least two known supported transfers using separately authorized devnet funding, then configure `DEMO_WALLET` to that address.
