# Focused trust-boundary review

Reviewed for the 20 September 2026 completion release. This is a source/test review, not a formal independent security audit or a guarantee against a compromised host.

The operator authorizes a fixed task and policy. The model, purchased content, merchant response, facilitator and RPC each remain separate trust boundaries. The signer and journal live on the same controlled server. A host administrator or stolen payer key can bypass application controls: there is no onchain budget escrow.

| Threat | Enforcement / recovery | Evidence |
| --- | --- | --- |
| Model changes price, payee, network, cap or endpoint | Fixed catalog, strict schemas, frozen policy, pre-sign transaction inspection | Policy, agent, network and HTTP adapter tests |
| Altered 402 or hidden transfer/authority instruction | Pin exact origin/path/method/version/asset/amount/sponsor; allow only reviewed instructions/accounts | Guard and SDK-builder tests |
| Concurrent proposals / same identity with changed arguments | Atomic `BEGIN IMMEDIATE` reserve, canonical hash, durable signing claim; conflict instead of new purchase | Policy/HTTP concurrency and replay tests |
| Response lost after signing or submission | Preserve original message/signature/blockhash and held balance; bounded original-payload replay and read-only proof | Recovery/restart tests; no replacement signing |
| Payment acknowledged but data malformed/unavailable | Payment accounting and delivery state remain distinct; validate response against tool/input/network schema | Merchant/buyer malformed-result tests |
| RPC mismatch, malformed envelope or fabricated token proof | Response ID/schema/genesis check; original message and expected SPL balance movement, fee/slot/error validation | Data/network/payment RPC tests |
| Stale service process or restored database | One authoritative journal lease; recheck before key use; restored journal locked until documented offline recovery | Lease, restore/backup tests |
| Logout/expired grant while a purchase awaits upstream work | Recheck session-bound external authorization at the signing boundary; logout stops the built-in runner; submitted work remains held | Grant, auth, agent race tests |
| Stolen session / cross-origin mutation | Argon2id, session rotation/expiry, HttpOnly host-only Secure cookies on HTTPS, strict SameSite, CSRF/origin checks, throttling | Auth tests, isolated private browser journey |
| Sensitive public export / build leak | Owner-scoped no-store APIs; omit signed payload/grant/credential bytes; static code/build/route isolation | Export/browser tests; release publication scan |
| Unbounded provider/model activity | Fixed upstream origins, redirects refused, bounded responses/timeouts/calls/tokens, no SDK model retries | Data, agent and payment adapter tests |
| Browser fixture mistaken for payment proof | Rehearsal labels, no generated transaction signatures or Explorer proof links, static `connect-src 'none'` | Hosted production journey and JSON export checks |

A database-only lease cannot fence another independently created database using the same payer, and restoring an old copy can omit later spending. Operate exactly one funded payer authority and retain complete backups/evidence. Never reuse its key with another journal. A signing crash without durable payload can remain unknown indefinitely; the UI must retain the hold, not offer an unsupported reset/refund. Original blockhash validity checks do not establish non-payment on their own.

Public-data merchant replay is not a confidentiality scheme for future private resources. Any private-data merchant or remote MCP transport requires its own access-control review. Arbitrary URL/tool registration remains out of scope.
