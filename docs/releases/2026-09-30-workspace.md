# Workspace and product tour release

Last updated: **30 September 2026**.

This release reorganizes the app around **Overview**, **Runs**, **Payments**, and **Setup**, with a desktop sidebar and phone navigation. The policy lab and agent walkthrough share the same workspace. Section links preserve browser history; switching sections keeps an unfinished assignment and its one-time external grant in the current page session.

On an authenticated backend, **Runs** supports text search and status filters, **Payments** contains recipient mandates and payment receipts, and **Setup** groups connection readiness and sign-out. Expired authentication clears private workspace data and grants. The static public deployment shows connection requirements in these sections; it does not supply an operator session, private records, or a payment wallet.

The `/demo` page adds a 53.04-second product tour with chapter controls, English captions, a transcript, and a downloadable video. It records actual public workspace and policy-lab interactions with a visible **No funds moved** boundary. The 51.04-second generated Niki narration uses Runway's `eleven_v3` model, with a one-second lead-in and outro. Interactive outcome fixtures remain available below the film. See the [walkthrough guide](../demo-script.md) and [production procedure](../product-tour-production.md).

The preflight command now supports `--rail direct` and `--rail all`; the default remains x402. Its journal inspection is read-only and does not migrate a database, recover transactions, or acquire the application service lease. Missing or outdated journals fail readiness. A direct-only inspection does not require x402 merchant, facilitator, data-provider, or model credentials. See [live setup](../live-setup.md).

## Release evidence

Local validation passed: 282 unit tests, all five authenticated workspace browser cases, all 16 hosted browser cases, TypeScript, lint, and both production builds. One hosted case was repeated with a separate artifact directory after simultaneous test processes collided during trace teardown; its application assertions and isolated repeat passed. Independent code and TypeScript reviews found no remaining blockers.

The [media provenance manifest](../../evidence/product-tour-2026-09-30.json) records the capture boundaries and SHA-256 hashes for the video, poster, captions, and transcript. The encoded film is 1920×1080 H.264/AAC, 53.066 seconds, and 4,054,754 bytes. Measured narration loudness is −16.4 LUFS with a −1.5 dBFS true peak. Browser coverage includes chapter seeking, native captions, all downloads, 320px layout, and failed-media fallbacks.

The repository's [release workflow](https://github.com/operatoruplift/allowance/actions/workflows/ci.yml) is the final gate for the full application, hosted build, and production container. Deployment and onchain settlement are separate checks; none of the test or media results certifies a mainnet payment.

## Mainnet activation

Mainnet remains the default configured network. At preparation time, the persistent backend host and private payment configuration were not connected, and no Allowance mainnet transaction had been verified. Activation still requires the durable host, operator credentials, funded dedicated payer, initialized token accounts, reviewed payment-provider configuration for x402, and the explicit spending gates. Built-in agent execution also requires its model provider. The tour, policy-plan export, and controlled browser tests are not settlement evidence.
