# Sources, provenance and acknowledgments

Reviewed **2026-09-12**. External documentation and public chain reads are evidence of those sources at observation time; neither proves an Allowance payment was executed.

## Primary implementation references

| Source                                                                                                                                                                                                                   | Used for                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| [Solana agentic payments](https://solana.com/docs/payments/agentic-payments)                                                                                                                                             | Agent-payment context and exact-payment integration references           |
| [x402 buyers](https://docs.x402.org/getting-started/quickstart-for-buyers) and [sellers](https://docs.x402.org/getting-started/quickstart-for-sellers)                                                                   | Official client/server architecture                                      |
| [Network and token support](https://docs.x402.org/core-concepts/network-and-token-support)                                                                                                                               | Network and asset configuration                                          |
| [Lifecycle hooks](https://docs.x402.org/advanced-concepts/lifecycle-hooks)                                                                                                                                               | Pre-sign guard integration                                               |
| [Payment identifier](https://docs.x402.org/extensions/payment-identifier)                                                                                                                                                | Stable logical purchase identity                                         |
| [x402 repository](https://github.com/coinbase/x402) and [exact SVM scheme](https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_svm.md)                                                    | Installed v2 exports/types, signer and fee-sponsor contract              |
| [Circle USDC addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses)                                                                                                                               | The official Solana devnet USDC mint                                     |
| [Solana getBalance](https://solana.com/docs/rpc/http/getbalance), [getSignaturesForAddress](https://solana.com/docs/rpc/http/getsignaturesforaddress), [getTransaction](https://solana.com/docs/rpc/http/gettransaction) | Validated data request and response contracts                            |
| [OpenAI function calling](https://developers.openai.com/api/docs/guides/function-calling)                                                                                                                                | Narrow Responses API tools and tool-result handling                      |
| [Official payment channels](https://github.com/solana-foundation/payment-channels)                                                                                                                                       | Separate future transport; see [compatibility note](payment-channels.md) |
| [Hackathon page](https://hackathons.solana.com/hackathons/agentic-payments-mtxd9fkr)                                                                                                                                     | Event status; no detailed dates/rules exposed in observed page           |

## Public read-only observations

`https://api.devnet.solana.com` returned HTTP 200 for `getGenesisHash`, yielding `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`. Its first 32 characters match payment network `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`.

A confirmed parsed `getAccountInfo` response at slot **497177823** identified Circle devnet mint `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`, owner `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`, decimals **6**, initialized **true**, executable **false**. Mint identity is validated independently from its display name.

At **2026-09-12 12:04 UTC**, unauthenticated GET to [the test facilitator's supported endpoint](https://x402.org/facilitator/supported) returned HTTP 200 and advertised v2 exact SVM devnet support. The observed fee payer was `CKPKJWNdJEqa81x7CkZ14BVPiY6y16Sxs7owznqtWYp5`. This resolves the earlier planning-environment 403 for this endpoint only. Verification, settlement, payer funding and sponsored-transaction success were not established by that read. Operators must review and explicitly pin the current fee payer rather than trust this historical value automatically.

At **2026-09-12 12:11:48 UTC**, bounded reads found public devnet wallet `8sh86hmWL4ka7U44dFn3U72ZagLsAME4iRMwajfgR8QT` in two successful `transferChecked` transactions. Each observed transfer had raw amount `1000`, decimals `6` and the Circle devnet USDC mint. Compute-budget and memo instructions were also present.

| Signature                                                                                  | Slot      | Observation                         |
| ------------------------------------------------------------------------------------------ | --------- | ----------------------------------- |
| `37MRZHnG3KsbvZXTgsnbR3FS91p5FjYECi4CLTx1ve2beWMgS9imKPgPHL4W5AZReMtKPPxVAoSpFN4DXKhhPkt2` | 497180980 | Confirmed, error null               |
| `2DGZzskCC4KMRu79LDMBpsKys63zSWc4z6ioAULQE7E7NQnkFc2mBpwj7Qw2KCdeF5uw62AWVw5hEmAB2CVa3ujP` | 497180799 | Finalized history entry, error null |

These are unrelated public transactions, **not purchases made by Allowance**. No identity or intent is attributed to the wallet, and its history may change or leave public-RPC retention. It is a useful dated data sample, not a controlled repeatable demo wallet. No transaction was signed, sent or funded by these reads.

A separate read-only `getGenesisHash` request to the public mainnet RPC returned HTTP 200 and `5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d`. It verified the optional data-network constant only; no mainnet payment capability was added or used.

## Original work and licenses

The product implementation, first-party merchant data logic, receipt/policy design, visual identity, SVGs and demo fixtures were created for Allowance. The working name does not assert trademark availability. No Buffer or Lotline project was modified, and their brands/assets are not reused.

Official x402 implementations are reused under their published license; they are not represented as newly authored protocol code. Payment-related dependencies are pinned: x402 packages `2.25.0`, Solana Kit `5.5.1` and the compatible token/compute-budget packages in the manifest. Consult `package-lock.json` for the complete resolved dependency graph and each installed package's license file for exact terms. Major reused libraries include React, Vite, TypeScript, Tailwind, Express, Zod, OpenAI's SDK, better-sqlite3, Argon2, express-session, lossless-json and Lucide icons. Their authors retain their respective copyrights.

## Red brand edition and selected films — September 15, 2026

The supplied Allowance mockup informed the palette and editorial layout. The September 15 edition used a boundary-and-dot mark. On September 19 the user-requested two-part curved A was restored from the original source SVG, superseding that handoff geometry. All 26 downloadable compositions, favicon and application icons were regenerated from the curved A. No generated composition claims actual paid activity or verified settlement.

The selected landing films are locally served derivatives of the supplied source media so the public rehearsal can keep a strict self-only media policy. Source URLs: [Axiom cloud film](https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260827_000114_3a4353ea-66bd-4c61-afe8-db78a4495313.mp4), [Axiom cloud poster](https://d2ol7oe51mr4n9.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/bb93fb3b-7156-469c-8d7d-d48c4adcf876.png), [Constellation mountain film](https://d2ol7oe51mr4n9.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/59667f02-3a0c-4b7b-be8a-072215ffbaa9.mp4), and [Constellation mountain poster](https://d2ol7oe51mr4n9.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/6d67c4db-fc8f-4e20-b5d1-0d9f82ce7a69.png). The checked-in MP4s are muted H.264 derivatives at 960px square (cloud) and 1280×720 (mountain); posters retain their supplied art.

The website bundles Figtree and Geist Mono Latin variable WOFF2 files from pinned Fontsource 5.3.0 distributions: [Figtree](https://cdn.jsdelivr.net/npm/@fontsource-variable/figtree@5.3.0/files/figtree-latin-wght-normal.woff2) and [Geist Mono](https://cdn.jsdelivr.net/npm/@fontsource-variable/geist-mono@5.3.0/files/geist-mono-latin-wght-normal.woff2). Complete SIL Open Font License notices are in `public/fonts`.

The reproducible asset generator uses the original variable TTF fonts from the official Google Fonts [Figtree](https://github.com/google/fonts/tree/main/ofl/figtree) and [Geist Mono](https://github.com/google/fonts/tree/main/ofl/geistmono) directories, bundled with their OFL notices in `public/brand/fonts`. These font binaries were checked against their stated sources. [fontkit](https://github.com/foliojs/fontkit), pinned to 2.0.4 and MIT licensed, converts glyphs to outlined paths; Playwright Chromium renders the SVG compositions to PNG. Font files retain their own licensing; the original composition source is covered by the project MIT license.

## Mainnet implementation references — September 19, 2026

Rechecked the official [x402 exact SVM scheme](https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_svm.md) and [Circle native USDC address table](https://developers.circle.com/stablecoins/usdc-contract-addresses) for mainnet CAIP-2 `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` and USDC mint `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` (six decimals). These values are now part of the immutable network/mint mapping used by the application. Devnet constants remain separately mapped for historical receipts and explicit test configurations.

Controlled tests exercise the official x402 HTTP client/server path against deterministic mainnet adapters, reject cross-network challenges, and verify recovery using original intent bindings. These tests establish application behavior; they do not establish production facilitator access, wallet funding or a real settlement. No mainnet signing or settlement request was sent during this release.

## Completion review — September 20, 2026

Rechecked the official x402 [buyer](https://docs.x402.org/getting-started/quickstart-for-buyers), [seller](https://docs.x402.org/getting-started/quickstart-for-sellers) and [payment-identifier](https://docs.x402.org/extensions/payment-identifier) documentation alongside the installed `2.25.0` SDK types. The exact SVM specification and Circle table still match both pinned network/mint mappings. Solana's [getTransaction](https://solana.com/docs/rpc/http/gettransaction), [isBlockhashValid](https://solana.com/docs/rpc/http/isblockhashvalid) and [getLatestBlockhash](https://solana.com/docs/rpc/http/getlatestblockhash) references support keeping the original message/blockhash context and treating a missing transaction conservatively. Current [MCP server guidance](https://modelcontextprotocol.io/docs/develop/build-server) was checked; this project retains the installed split server/client `2.0.0` APIs instead of adopting incompatible historical examples.

At **2026-09-19T17:48:20Z–17:48:21Z** (September 20 locally), public read-only RPC checks validated both genesis hashes and both native USDC mint owners, initialized state and six decimals. Mainnet observed mint slot `448479553`; devnet `500974610`. The public test facilitator advertised v2 exact **devnet**, with no mainnet SVM entry. Its support response is not a selected production provider or settlement evidence. Original results are in [public-network-2026-09-20.json](../evidence/public-network-2026-09-20.json). No payer, private wallet, verify/settle request or account funding was involved.

The official event page still shows funding-dependent scheduling; no submission deadline, eligibility decision or final judging environment was established. Existing submission text remains a draft. No public event action was performed.

The supplied cloud/mountain URLs establish asset provenance, not an independent license grant. No separate media license file was supplied with those films; retain the user's supplied assets and source attribution, and obtain provider permission before claiming the third-party footage itself is MIT-licensed. Application code, original compositions and bundled OFL fonts keep their respective existing notices.
