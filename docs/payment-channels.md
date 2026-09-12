# Later milestone: payment channels

Allowance currently targets x402 v2 **exact** SVM payments: one payment per paid API call. A single run-start action is user authorization, not a single chain settlement. Payment channels are not implemented or shown as a live feature.

The official [Solana Foundation payment-channels project](https://github.com/solana-foundation/payment-channels) was inspected on **2026-09-12**, at commit [`3ffa4d6728ad88e4a9667a76ad9ccd68a302c696`](https://github.com/solana-foundation/payment-channels/tree/3ffa4d6728ad88e4a9667a76ad9ccd68a302c696), committed 2026-08-07. Its README reports a mainnet deployment, but this review did not verify the deployed program onchain. Its batch/re-arm/rollup proposals are roadmap items, not shipped features.

## Compatibility observed

- The repository contains a generated TypeScript client named `@payment-channels/client`, version `0.1.0`, with `@solana/kit` and `@solana/program-client-core` `^6.1.0` dependencies. See its [package manifest](https://github.com/solana-foundation/payment-channels/blob/3ffa4d6728ad88e4a9667a76ad9ccd68a302c696/clients/typescript/package.json). No compatibility with Allowance's pinned exact-payment Kit `5.5.1` is assumed.
- A `build-devnet` recipe exists. The inspected devnet treasury owner remains a sentinel, and cluster builds explicitly reject that placeholder. See [cluster constants](https://github.com/solana-foundation/payment-channels/blob/3ffa4d6728ad88e4a9667a76ad9ccd68a302c696/program/payment_channels/src/constants.rs) and [build recipes](https://github.com/solana-foundation/payment-channels/blob/3ffa4d6728ad88e4a9667a76ad9ccd68a302c696/justfile). A ready, compatible devnet transport has not been established.

## Separate lifecycle

A channel requires funding and opening an escrow, issuing signed cumulative claims, settling the accepted watermark, sealing/closing, and distributing the merchant payment and payer remainder. Cooperative close differs from forced close and its grace period. Claim expiration and open-slot validity are separate constraints. Recovery must cover stale claims, interrupted settlement and refund/close observation. The current exact-payment request journal cannot simply be renamed a channel ledger.

The next step is a separate local-validator compatibility spike pinned to that commit: establish supported SDK versions and program identity; exercise open, two cumulative vouchers, settle, forced-close/expiry and refund recovery; then design a channel transport behind the existing policy interface. Obtain and verify a supported devnet deployment before a devnet integration demonstration. No program deployment, funding transaction or channel claim was performed for this MVP.
