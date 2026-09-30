# Product walkthrough scripts

Last updated: **30 September 2026**.

## Narrated product tour: 53 seconds

Open [the agent walkthrough](https://allowanceonsolana.vercel.app/demo#product-tour), then play **A budget. A boundary. A clear record.** The player offers five chapters, English captions, **Save video**, **Read transcript**, and **Download captions**. Playback starts only when the viewer chooses it. **Try the controls** opens `/lab`.

The film records actual public workspace and policy-lab interactions. Its persistent **Workspace tour · No funds moved** caption distinguishes this footage from a funded agent run. The 51.040-second voiceover uses the generated Niki voice through Runway's `eleven_v3` model, with one second before and after the narration. It is not a human-recorded performance. See [the production procedure](product-tour-production.md) for recording and assembly; the transcript is [included with the media](../public/media/allowance-product-tour.txt).

| Time           | Screen/action                                                                | Story                                                                                                 |
| -------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 0:00–0:11.2    | `/app?view=overview`; show the workspace navigation and current setup notice | Useful work needs a spending boundary.                                                                |
| 0:11.2–0:20.7  | Open **Policy lab**; show the default requests and totals                    | A 0.010000 snapshot and 0.020000 explanation fit a 0.040000 allowance; a second explanation does not. |
| 0:20.7–0:25.5  | Set **Per-request cap** to `0.010000`                                        | The cap blocks both explanations immediately.                                                         |
| 0:25.5–0:28.5  | Reset, then turn off **Transaction explanation**                             | Tool permission is another independent boundary.                                                      |
| 0:28.5–0:32.8  | Visit **Runs**, **Payments**, and **Setup**                                  | The workspace gives each job a clear home.                                                            |
| 0:32.8–0:37.5  | Return to the lab and choose **Save policy plan**                            | Download the actual plan and decisions.                                                               |
| 0:37.5–0:46.1  | Show **Setup** and the connection requirements                               | The tour moves no funds; live payments need the configured operator backend.                          |
| 0:46.1–0:53.04 | Return to **Overview**                                                       | Useful tools, clear limits, and recorded decisions.                                                   |

On desktop, **Overview**, **Runs**, **Payments**, and **Setup** appear in the sidebar. On phones, they form the bottom navigation; **Policy lab**, **Walkthrough**, and **Guide** remain available above the page. Section URLs survive refresh and browser Back. On the static public deployment, these sections show the connection requirements rather than private run history or invented balances. The authenticated backend adds assignments, searchable run history, payment mandates, receipts, and readiness checks.

## Policy lab: a 60-second walkthrough

Start with `/lab`, reached from **Explore the policy lab** on the landing page. This is a working capacity planner, not a payment run. Keep **No funds moved** visible and describe the amounts as planned tool costs. The page recalculates immediately; there is no run button.

| Time      | Screen/action                                                                 | Narration                                                                                                                                                                                              |
| --------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0:00–0:12 | Open `/lab`; show the three limits                                            | “Give the task 0.040000 USDC, cap each request at 0.020000, and make 0.100000 available for the day.”                                                                                                  |
| 0:12–0:25 | Show the initial three requests and totals                                    | “A wallet snapshot costs 0.010000. A transaction explanation costs 0.020000. Those two fit; the next explanation exceeds the remaining allowance. Planned costs are 0.030000, leaving 0.010000.”       |
| 0:25–0:37 | Change **Per-request cap** to `0.010000`                                      | “The smaller cap blocks both explanations. Only the wallet snapshot fits, so planned costs fall to 0.010000. The requests are checked in order, and a blocked request consumes none of the allowance.” |
| 0:37–0:47 | Press **Reset limits and requests**, then uncheck **Transaction explanation** | “Permission is a separate boundary. A tool can be blocked even when its price fits the budget.”                                                                                                        |
| 0:47–1:00 | Reset again, then press **Save policy plan**                                  | “Save the plan to review its limits and decisions. No transaction was submitted. Running an agent requires an authenticated server policy and payment readiness.”                                      |

The downloaded `allowance-policy-plan.json` identifies itself as `kind: "policy-plan"` with `paymentSubmitted: false`; amounts are integer micro-USDC strings. It contains no settlement signature and cannot authorize spending. The planner covers catalog tools only, not direct-payment mandates. SOL fees and model usage are separate from its USDC figures.

For a longer tour, lower **Daily capacity** to `0.020000`, add or remove requests, and enter an invalid amount to show the message next to its field. Reset before comparing results with the table. Record phone installation only on a device you actually tested; the Android shell does not yet provide a verified native file-download flow.

## Interactive outcomes on `/demo`

Above the film, **Try the controls** jumps to **Try an outcome**. Use **Choose a scenario** to select the outcome. This is a separate deterministic fixture interface: its timeline, report, and accounting do not come from paid services or a model. Refresh resets it. The notice states **No funds moved. Preloaded data; no signing, model calls, RPC requests or payments.** Expanded purchase rows show **None — no transaction submitted** under **Chain evidence**. Retain these notices in any recording.

| Action                                                                                 | What to show and explain                                                                                                                                          |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Choose **Two purchases + a budget boundary**, then **Run walkthrough**                 | The fixture advances through two tool responses with 0.030000 represented as settled and 0.010000 remaining. These are fixture amounts, not verified transfers.   |
| Press **Test the boundary** after the run finishes                                     | A separate 0.020000 policy probe is denied; it is outside the agent trace and leaves the 0.010000 remaining amount unchanged.                                     |
| Open **Receipt**, expand a purchase, then choose **Export JSON** or **Print receipt**  | Inspect payment state, service outcome, and absent chain evidence. The exported fixture receipt has no transaction signature.                                     |
| Choose **Wallet with no transaction history**, then run again                          | The snapshot returns no history; no transaction explanation is needed.                                                                                            |
| Choose **Service failure before signing**, then run again                              | The unsigned reservation is released; the fixture retains the failure outcome.                                                                                    |
| Choose **Settlement unknown, then reconcile**, run again, then **Review offline hold** | Follow the original unresolved request through recovery. Explain that this browser action updates fixture state; it does not query or prove settlement on Solana. |

Allow viewers time to read the report and expand receipt details. Do not force these branches into the short narrated film. **Run again** resets the selected outcome; a running sequence can be stopped with **Stop run**. **Export JSON** downloads `allowance-walkthrough-receipt.json`; its internal `rehearsal` mode preserves the fixture provenance. The policy lab is the editable planning surface, while these outcome fixtures explain accounting and recovery.

The live console needs a durable server, operator authentication, a dedicated network-specific payer and merchant, reviewed provider/sponsor, initialized funded token accounts, and model access for built-in AI execution. See [integration status](integration-status.md) and [live setup](live-setup.md). A funded smoke, model-driven run, local MCP exchange, recorded public plan, and browser fixtures remain distinct evidence.

## Recording a genuine live run

Follow the network-specific setup and separately authorized smoke procedure in [live-setup.md](live-setup.md), and save its dated evidence. Mainnet requires an explicit mainnet spending authorization; the devnet smoke command must never be repurposed to spend mainnet funds. For the live video, show the actual data and payment network labels with **Live execution**, the actual run ID, two settled transactions and their network-correct explorer links. Demonstrate refresh recovery. Show the final separately labeled policy probe and verify there is no third payment. The final accounting should be 0.030000 settled, 0 held and 0.010000 remaining only if actual evidence supports it.

If the model legitimately skips the optional transaction, say so. If a payment is held/unknown or settled with result unavailable, preserve that status, explain recovery and do not claim a successful completed demo. Keep LLM charges and SOL fees/rent separate from the USDC tool allowance.

For a repeatable live recording, configure `DEMO_WALLET` with a data wallet that has at least two known supported transfers on the configured data network. Confirm that the transactions remain available before recording. The wallet being analyzed and the dedicated wallet paying for tools serve different roles; neither read-only history nor a funded account alone proves an Allowance purchase.
