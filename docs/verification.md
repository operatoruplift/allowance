# Verification report

Recorded on **September 12, 2026**. This report distinguishes local controlled tests, public read-only network evidence, and unperformed live payments.

## Delivery status

The application, public rehearsal, operator access, durable SQLite ledger, exact x402 HTTP buyer/merchants, bounded Responses API runner, local stdio MCP bridge, receipt UI, developer example, SVG identity, Docker setup and submission drafts are implemented. Live payments remain **unavailable in the delivered configuration**. No real Allowance devnet settlement or paid OpenAI call was performed. The hackathon working-payment demonstration is therefore **not yet evidenced**.

## Initial local verification

| Check                                 | Result                                                                                                                                                                                                             |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Lint                                  | Passed                                                                                                                                                                                                             |
| TypeScript, frontend and backend      | Passed                                                                                                                                                                                                             |
| Production Vite + Node build          | Passed                                                                                                                                                                                                             |
| Controlled tests                      | 79 passed across 9 files in the final full `npm test`                                                                                                                                                              |
| Payment HTTP / real SDK builder tests | 16 passed; actual Express x402 middleware and installed ExactSvmScheme with controlled facilitator, local RPC and test signer                                                                                      |
| Shared rehearsal decision tests       | 2 passed; same pure policy evaluator as backend                                                                                                                                                                    |
| Browser journeys                      | All 4 passed together in 23.3 seconds: public flows plus real authenticated private access in an isolated controlled server                                                                                        |
| Public browser coverage               | Landing, keyboard CTA, operator gating, developer guide, two fixture purchases, separate probe, export, print, empty history, service failure, refresh reset, 390px, reduced motion and 200% CSS zoom              |
| Private browser coverage              | Real password login and session; seeded zero-purchase run restored after refresh; Stop persisted; JSON totals exact; separate unauthenticated context denied list/read/export. Payment and model services disabled |
| npm dependency audit                  | 0 reported vulnerabilities at installation; this is not a guarantee of security                                                                                                                                    |
| Devnet smoke command without opt-in   | Exited 2 before runtime/signing, as intended                                                                                                                                                                       |
| Read-only application preflight       | Exited 1 with exact missing configuration; data RPC check passed                                                                                                                                                   |
| Docker image execution                | Not executed; Dockerfile and volume instructions supplied                                                                                                                                                          |

Initial command results are recorded in `evidence/local-checks.json`. Desktop and mobile captures were visually inspected after the passing browser suite. The private screenshot is explicitly a controlled authentication test with no purchases or live settlement.

The private browser harness also passed three parallel repetitions after isolating each worker's port. Lint and TypeScript passed again after the final test changes; a separate reviewer approved the browser harness and public network-isolation assertions.

The compatible pinned payment stack is `@x402/{core,svm,fetch,express,extensions}` 2.25.0, Solana Kit 5.5.1, SPL token client 0.9.0 and compute-budget client 0.11.0. These versions satisfy the SVM implementation's peer ranges. TypeScript 5.9.3 satisfies Kit's compiler peer range. The lockfile is committed with the repository.

The official `@modelcontextprotocol/server` and `@modelcontextprotocol/client` packages are pinned to 2.0.0. Controlled MCP tests cover fixed-tool discovery and strict schemas, wrong grants, session revocation, stop cancellation, safe payment errors and a real child-process stdio exchange. MCP stdout remains protocol-only; diagnostics are sent to stderr. These tests do not create a grant through a live operator session and do not spend devnet funds.

The test suite includes strict decimal parsing, caps/expiry/allowlists, daily ceilings across runs and UTC rollover, wrong network/mint/payee/price, duplicate and concurrent requests, database outage, policy override attempts, authentication/CSRF/session rotation/throttling, pre-sign rejection, response loss, uncertain settlement, restart reconciliation, cancellation, runtime expiry, and denying a third purchase without another signer call. The real SDK transaction builder is exercised locally; test signatures and settlements are fixtures and do not establish chain activity.

## Independent reviews

Two independent reviewers examined code and security boundaries. Material findings were fixed and re-reviewed:

- Exclusive durable service ownership now precedes startup recovery; a stale owner cannot authorize signing.
- A hard runtime deadline is checked by the ledger even if a timer is delayed; runtime termination releases only unsigned reservations.
- Duplicate purchases cite the original durable receipt ID. Failed proposals do not invent purchase references.
- Authenticated cached merchant responses can recover without new-spend readiness or a funded payer.
- Recovery attempts are claimed atomically; ineligible rows cannot starve older recoverable receipts.
- SDK construction has a bounded timeout that permanently closes its signing scope.
- Merchant verification has per-IP/global/daily limits and a two-request concurrency bound.
- The signer validates an immutable byte copy and checks the final payload identity.
- SOL display values use SOL units, separately from micro-USDC.

Both final reviews approved the revised scope with no material remaining findings. This is a scoped code review, not a formal security audit or a compromised-server guarantee.

## Public read-only evidence

These reads did not sign, broadcast, fund an account, or purchase a service:

- Devnet genesis: `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`.
- Circle devnet USDC mint: `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`, initialized under the SPL Token Program, **6 decimals**. Read at slot 497177823.
- `https://x402.org/facilitator/supported` returned **HTTP 200**, advertising x402 v2 exact devnet with fee sponsor `CKPKJWNdJEqa81x7CkZ14BVPiY6y16Sxs7owznqtWYp5`. `/supported` did not require authentication in this observation. No verify/settle request was sent to the real facilitator; support advertising alone does not prove settlement works.
- A public devnet address with two suitable transfer transactions was inspected. Those are unrelated existing transactions, **not Allowance purchases**, and the address is not owned, prepared or funded by this project. Use a dedicated controlled address for a repeatable live recording.
- The current hackathon page returned HTTP 200 when fetched directly and showed sponsorship/funding-dependent scheduling. No launch date, submission deadline or detailed rules were established. No Stocklana date was imported and no registration/submission occurred.

Saved JSON evidence: `evidence/public-devnet-read.json`, `evidence/public-wallet-history.json`, and `evidence/public-devnet-transactions.json`. Source URLs and the channel repository commit are documented in [sources](sources.md).

## Exact missing setup and the next verification

The observed application preflight at **2026-09-12T12:41:50Z** reported:

1. `OPERATOR_PASSWORD_HASH` and `SESSION_SECRET`: create with `npm run setup:operator`.
2. `LIVE_PAYMENTS_ENABLED=true`: explicit devnet opt-in remains off.
3. A dedicated, low-balance devnet key in `PAYER_SECRET_FILE` (or server-only `PAYER_SECRET_JSON`).
4. `MERCHANT_RECIPIENT`, a different address, and initialized payer/recipient USDC associated token accounts.
5. Test USDC for the two purchases and test SOL where needed for account setup; no funds were requested.
6. `TRUSTED_FEE_PAYER`, pinned after reviewing current facilitator support. Do not silently learn trust from a response.
7. `OPENAI_API_KEY` and explicit `OPENAI_MODEL` for the autonomous run. Model access has not been tested.
8. `DEMO_WALLET` with at least two suitable transactions for repeatability.

Default devnet RPC reads passed; they may later need a separately configured reliable endpoint. Run `npm run preflight`, then, after setup and deliberate test spending authorization, `npm run smoke:devnet -- --confirm-devnet-spend`. Stop the local app first because the standalone smoke command owns its merchant listener. The command writes dated evidence and requires two delivered, independently chain-verified purchases plus the separate blocked probe before reporting the scenario demonstrated. It makes no LLM call; an autonomous operator run is a separate trace.

## Public Vercel rehearsal follow-up

On September 12, 2026, the user authorized public deployment. The static rehearsal is now available at [allowanceonsolana.vercel.app](https://allowanceonsolana.vercel.app). The live backend is not deployed there: the output contains only six static files and routing configuration, with no functions, database, signer or model runtime.

The deployment follow-up passed lint, TypeScript, both builds, all 75 controlled tests, four normal browser journeys and two hosted journeys. An independent reviewer approved the deployment boundary, routing, Content Security Policy, and print fix. A print regression test confirms newly revealed timeline entries are immediately visible without waiting for screen animations.

Public HTTP verification confirmed the six page routes return 200, API/merchant/source/secret-file paths return 404, and POST to the rehearsal returns 405. All published static assets match their local SHA-256 hashes. The exact deployed revision, deployment ID, recording time and final browser results are in `evidence/vercel-deployment.json`. Screenshots and the PDF under `evidence/hosted-*` come from the public site and still show only deterministic fixtures.

A persistent backend hosting target remains to be selected. Operator credentials, a dedicated devnet payer, recipient/token accounts, trusted sponsor, provider configuration, a prepared data wallet and test funding remain required for live execution. No devnet payment or paid model request was made as part of this deployment, and the hackathon working-payment demonstration remains unevidenced.

## Red interface and brand library — September 13, 2026

The selected boundary-and-dot mark, red/paper palette, local Figtree/Geist Mono typography and ruled interface are implemented across public and private routes. `/brand` contains 26 compositions in PNG and outlined SVG, category filtering, accessible previews, individual downloads, full-size image links, palette copying and a complete ZIP. The kit includes profiles, headers, phone/4K wallpapers, social artwork and backgrounds, with font licenses and a reproducible local generator.

The design follow-up passed lint, frontend/backend TypeScript, all 75 controlled tests, normal and static builds, four normal browser journeys (41.2 seconds), and four local hosted journeys (35.8 seconds). The first brand test run found a Node ESM JSON import incompatibility; the native import attribute fixed it, and the full hosted suite then passed. No paid API or payment test was used.

Browser QA inspected landing, rehearsal, developers and brand routes at 320, 390, 768 and 1440 CSS pixels, reduced motion, keyboard skip navigation, preview focus/escape restoration and 200% zoom/reflow. Two findings—tablet console navigation and intrinsic header wrapping—were fixed and independently re-reviewed. Full-size images and PNG/ZIP downloads work; native iOS/Android Save-to-Photos sheets were not exercised. The detailed checks are in `evidence/design-responsive-qa.json`.

Independent code and publication/security reviews approved the final changes. The asset audit checked all 26 compositions, 29 SVGs and the 66-entry ZIP: no active SVG content, external asset calls, private state or credentials were found. Complete font notices accompany source-matched font binaries. All 26 PNG dimensions and ZIP integrity passed. These are scoped checks, not a formal security audit. The later external-agent bridge and explicit receipt-evidence changes are covered by the current 79-test local suite; real settlement and model execution remain pending the configuration listed above.

The red edition was deployed to [allowanceonsolana.vercel.app](https://allowanceonsolana.vercel.app), including the public `/brand` route, on September 13. All four production browser journeys passed in 13.7 seconds. Public verification checked 18 route/method responses and matched all 97 deployed static files against local SHA-256 hashes. The static network restriction remains `connect-src 'none'`; API and merchant paths remain unavailable.

On September 14, 2026, the current build was promoted to production as `dpl_82MNDYsm16aFHG8RG6hfAWdMDnAm`. The four hosted journeys passed in 23.2 seconds. The production document references `/favicon-red.svg`, which returned HTTP 200 with `image/svg+xml`; the index, favicon, red symbol, wordmark, CSS and JavaScript hashes are recorded in [production-deployment-2026-09-14.json](../evidence/production-deployment-2026-09-14.json). This remains a static public rehearsal; no payment or model runtime is present.

After explicit user approval, [operatoruplift/allowance](https://github.com/operatoruplift/allowance) was created publicly with the complete reviewed source and MIT license. An unauthenticated GitHub API read returned 200 and confirmed public visibility. The initial September 12 deployment evidence remains in `evidence/vercel-deployment.json`; `evidence/brand-deployment.json` records the red edition's deployment, asset hashes, public repository and final validation. No real payment or paid model call was performed during publication.

## Practical limits

Unknown payments remain held; recovery is bounded to four attempts per purchase and never creates a new signature. A crash inside signing before a replay payload is durably available can leave a conservative unresolved hold requiring manual evidence inspection. There is no automatic refund or manual “clear hold” escape hatch. Stop and restart do not reactivate old spending authorization.

Merchant replay authenticates the original signed payment, canonical request and payer, rather than a new requester's identity. These merchants return public Solana facts. Onchain signatures are public, so this replay design is not a confidentiality scheme for future private merchant data; such tools would need additional access control. Operator reports and exports remain session-protected.

Public rehearsal refresh intentionally resets its clearly labeled local fixture. Live run state, sessions, reservations and receipts live in SQLite and survive refresh/restart on a persistent disk. SQLite volume persistence and one app instance remain deployment requirements.
