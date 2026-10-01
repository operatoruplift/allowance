# Mainnet facilitator compatibility

Checked **1 October 2026** with public documentation and unauthenticated `GET /supported` and `GET /pricing` requests only. No payment was signed, verified, submitted or settled. Nothing here selects a provider, enables either payment rail, or installs a trusted sponsor.

## Public exact-payment option: PayAI

The [official Solana mainnet guide](https://docs.payai.network/x402/solana-mainnet-express) documents `https://facilitator.payai.network` for x402 v2 exact native-USDC payments. Its current tested example uses `@x402/*` 2.27.0; Allowance pins 2.25.0. Their request envelopes match the installed SDK and Allowance's bounded adapter, but discovery compatibility does not establish funded interoperability.

At 06:20 UTC, [public discovery](https://facilitator.payai.network/supported) returned HTTP 200 with v2 `exact` for `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`, and `extra.feePayer` was `CjNFTjvBhbJJd2B5ePPMHRLx1ELZpa8dwQgGL727eKww`. This is dated observation, **not a permanent configuration value**. Obtain the response again through the same authentication lane used for settlement, review the sponsor, and explicitly configure `TRUSTED_FEE_PAYER`. A changed sponsor must fail closed until reviewed.

The response also included legacy v1 names such as `base-sepolia` and `solana`. Allowance now validates these separately and removes all v1 capabilities before exposing discovery to its v2 client. Malformed v2 identifiers still reject the entire response, and actual spending still requires the configured network, exact scheme and pinned sponsor.

The [authentication guide](https://docs.payai.network/x402/facilitators/authentication) permits ordinary exact payments without credentials within the public allowance. Authenticated service uses a short-lived Ed25519 JWT generated from a merchant key ID and secret; a raw API secret is not a bearer token. Authenticated discovery can return an account-specific sponsor. Allowance's current static `FACILITATOR_TOKEN` does not refresh these JWTs: sustained authenticated PayAI service needs an auth adapter or compatible gateway. Do not paste a private key into that setting.

The [pricing guide](https://docs.payai.network/x402/facilitators/pricing) gives new receiving wallets **1,000 lifetime free credits**, not a monthly allowance. Shared host/IP pools can exhaust access earlier. Beyond that allowance, credits cost $0.001 each and settlements are priced at measured network gas plus 30%. The [live rate table](https://facilitator.payai.network/pricing), read at 06:20 UTC, listed mainnet exact transfers at 1.62 credits ($0.00162) each, effective 27 September 2026. Rates can change. This service charge is separate from an API's USDC price.

The [capacity guide](https://docs.payai.network/x402/facilitators/capacity-and-limits) warns that a timeout or `settlement_pending` can leave the transaction unresolved, including an empty Solana transaction field. Allowance retains its original authorization and conservative hold; a read of `/supported` cannot validate that recovery against a real provider. Token-account initialization also requires separate funding; sponsorship of the purchase does not create the required merchant USDC account.

## Authenticated alternative: Coinbase CDP

The [CDP facilitator documentation](https://docs.cdp.coinbase.com/x402/seller/facilitator) lists v2 exact Solana mainnet and requires a CDP API key ID and secret. It advertises 1,000 free onchain transactions each month and $0.001 per additional transaction. The [production guide](https://docs.cdp.coinbase.com/x402/seller/production-configuration) uses `createCdpFacilitatorClient` for authentication; direct REST requests require signed bearer JWTs. Allowance needs a compatible authentication adapter or gateway before this is a durable alternative. The documented endpoint is `https://api.cdp.coinbase.com/platform/v2/x402`; no authenticated request was made.

The default public test endpoint, `https://x402.org/facilitator/supported`, returned HTTP 200 but **no v2 exact Solana mainnet capability** at this check. Its successful response is not evidence that it can settle mainnet purchases.

## Still required for a real payment

Provision the persistent backend and operator access, an explicit mainnet RPC, dedicated payer key, initialized and funded payer USDC account, separate initialized merchant USDC account, reviewed sponsor, and bounded spending authorization. Select a provider whose account or public allowance is available from the deployed host. Then run the documented preflight and one intended funded scenario, preserving uncertain outcomes and independently checking chain evidence. The absence of a facilitator API key alone is not necessarily a blocker for PayAI's public exact lane; absent payer funds, signing authority and merchant configuration remain blockers.
