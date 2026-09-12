# Evidence provenance

All captures are dated September 12, 2026.

- `landing-desktop.png`: the implemented local product interface.
- `rehearsal-desktop-complete.png`: deterministic rehearsal receipt with two simulated purchases and a separate policy denial. **No real payment.**
- `rehearsal-mobile-complete.png`: the same rehearsal at 390px with reduced motion.
- `rehearsal-print.pdf`: readable browser print output of that fixture receipt.
- `controlled-browser-auth-no-payments.png`: real login/session/SQLite UI with an isolated seeded run, stopped with zero purchases. **Controlled authentication test; no live settlement or model call.**
- `local-checks.json`: results of lint, type checking, controlled tests, build and browser checks.
- `public-devnet-read.json`: read-only public RPC and facilitator support observation.
- `public-wallet-history.json`, `public-devnet-transactions.json`: unrelated pre-existing public devnet activity, inspected to establish useful data decoding. **Not Allowance payment evidence.**
- `vercel-deployment.json`: public Vercel deployment identity, HTTP route/security-header checks, and matching local/remote JavaScript hashes. **Static hosting evidence, not payment evidence.**
- `hosted-landing-desktop.png`, `hosted-rehearsal-console.png`, `hosted-console-mobile.png`, `hosted-rehearsal-receipt.png`, and `hosted-rehearsal-print.pdf`: captured by browser tests against the actual public Vercel deployment. All purchases and receipts shown remain deterministic fixtures.

A future authorized smoke command writes `devnet-smoke-<recording-date>.json`. No such genuine Allowance settlement artifact is claimed in this delivery. Test-generated signatures in test source code are controlled fixtures and never linked as real devnet purchases.
