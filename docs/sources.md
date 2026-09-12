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
