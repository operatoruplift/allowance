# Allowance implementation audit

**Audit date:** 15 September 2026  
**Repository:** `/Users/rvaclassic/Documents/Codex/2026-09-12/files-pasted-by-the-user-build/outputs/allowance`  
**Selected composition:** A14_RED — A1 Constellation + A4 Axiom in red  
**Audit mode:** local production and static rehearsal builds, controlled browser fixtures, read-only comparison with the public Vercel rehearsal. No funded transaction or paid model request was initiated; production deployment was performed afterward only when explicitly requested.

## Finding at a glance

The baseline still showed the earlier curved-A identity, a pink geometric hero backdrop, a single horizontal feature row, and no selected source films. The repaired candidate now uses the selected boundary-and-dot mark, red/paper system, Axiom cloud film with the existing interactive receipt, Constellation mountain strip, 2×2 feature cells, local Figtree/Geist Mono files, and motion controls that pause when offscreen, hidden, or reduced-motion is requested. After the audit was complete, the explicitly requested production deployment promoted this candidate to the public static rehearsal.

## Requirements matrix

| Source / requirement | Current implementation | Expected behavior | Verification | Outcome |
| --- | --- | --- | --- | --- |
| A14_RED design board and design implementation prompt | `src/App.tsx`, `src/styles.css`, public SVGs | Paper/white/ink/red palette, boundary-and-dot mark, editorial frame, one hero | Before/after screenshots at 1440, 1024, 390, 320; computed styles; browser journeys | **Verified locally** |
| Mark geometry `M7 23V7H25V23`, dot `(16,21)` | `public/allowance-symbol.svg`, favicon, wordmark and generated kit | Same mark in header, footer, favicon, private shells and downloads | SVG inspection; generated 26-asset kit; brand browser suite | **Verified locally** |
| Local Figtree and Geist Mono | `src/styles.css` and bundled font files | Loaded fonts used by display/body and technical metadata | `document.fonts.status === "loaded"`; `check('600 48px Figtree')`; `check('500 14px "Geist Mono"')`; computed body family | **Verified locally** |
| Hero copy and 54/46 cloud/receipt stage | `LandingReceipt` plus `.hero-media-stage` | “Give your agent a budget.”, supporting sentence, working `/demo` and `/developers`, one legible interactive receipt | Landing journey, keyboard CTA, screenshot and no live-request assertion | **Verified locally** |
| Axiom cloud and Constellation mountain source media | `public/media/allowance-cloud.{mp4,png}`, `allowance-mountains.{mp4,png}` | Matching locally served films/posters with visible cloud/peaks | `media.spec.ts` checks local `src`, ready state, advancing `currentTime`, crop is visible in screenshots; motion recording | **Verified locally** |
| Decorative motion behavior | `DecorativeFilm` | Pause control; offscreen, hidden-tab and reduced-motion pausing; cleanup | Focused media test plus full browser suite; recording | **Verified locally** |
| Feature structure and responsive reflow | `.feature-grid`, `.run-unfolds` | 2×2 desktop cells, one-column mobile stack, no fixed artboard overflow | 1440/1024/390/320 screenshots; 200% zoom; journey and hosted tests | **Verified locally** |
| Public rehearsal boundary | `scripts/build-rehearsal.ts`, generated `.vercel/output` | Static, clearly labeled, no API/model/payment execution, `connect-src 'none'`, same-origin media only | Build output CSP; browser request capture; hosted suite; route reload checks | **Verified locally** |
| Public comparison | Vercel deployment `dpl_34cQeJh8x2GSUudFSeSCrMY9yeYe` | Public parity with candidate after explicit deployment request | Read-only route checks, asset hashes, public hosted browser suite and recovery fixture | **Verified for static rehearsal** |
| Public/private route inventory | SPA routes `/`, `/demo`, `/developers`, `/brand`, `/login`, `/app`, `/runs/:id`, unknown route | Each route should render a truthful surface and reload | Local route sweep: all returned 200, no overflow or fetch/XHR; private static routes explain backend boundary | **Verified locally** |
| Rehearsal accounting | Existing fixture runner and receipt | Exact `0.040000` allowance, `0.010000` snapshot, `0.020000` explanation, `0.010000` remaining; separate `0.020000` denied probe; deterministic settlement-unknown recovery | Browser export assertions, no signatures/explorer links, empty/failure/reset/recovery scenarios | **Verified in controlled fixtures** |
| Durable operator/auth/ledger/policy | Existing server runtime, auth, ledger, policy and runner | Owner-scoped sessions, durable holds, bounded agent and guarded tool catalog | 80 Vitest tests; controlled auth browser journey; source inspection | **Verified by automated tests; live runtime unconfigured** |
| x402 Solana exact payment path | Existing `server/payments`, merchants and official x402 v2 adapter | Challenge, policy reservation, signing journal, facilitator submission, chain evidence and receipt | Unit/integration tests and preflight; no funded smoke | **Implemented; live evidence externally blocked** |
| MCP stdio adapter | Existing `server/mcp.ts` and tests | JSON-RPC stdout hygiene, scoped grants, no second ledger | MCP test suite in `npm test`; source inspection | **Verified by automated tests** |
| Brand/social kit | Generated `/brand` route and `public/brand` | Profiles, wallpapers, headers, ads/backgrounds, SVG/PNG/ZIP downloads | 26 manifest assets; brand browser suite; generated ZIP | **Verified locally** |
| Mainnet, payment channels, remote MCP, new providers | Not part of this implementation | Remain clearly deferred | Documentation and route copy | **Deliberately deferred** |

## Gaps fixed

- Replaced the curved red A in canonical symbol, favicon, wordmark and generated brand assets with the original open-bottom boundary-and-dot geometry.
- Replaced the pink geometric hero backdrop with the selected locally served Axiom cloud film and poster, while retaining the existing receipt state and interaction.
- Added the selected Constellation mountain film/poster below “How a run unfolds.”
- Changed the feature treatment from a single horizontal row to ruled 2×2 desktop cells with mobile stacking.
- Added accessible pause/play controls, offscreen pausing, hidden-tab pausing, reduced-motion behavior and cleanup for both decorative films.
- Added `media-src 'self'` to the server and static-rehearsal CSP while keeping the rehearsal `connect-src 'none'` boundary.
- Regenerated the 26-asset brand kit and manifest at version `2026-09-15`.
- Added `tests/browser/media.spec.ts`, including advancing playback, local-source isolation, manual pause/play, offscreen pausing, reduced motion and hidden-tab pause coverage.
- Added an ambiguous settlement fixture with an explicit reconcile action; recovery stays interrupted, preserves `settled-but-result-unavailable`, clears the original hold once, and never invents a second signature or delivery result.
- Corrected stale verification language that called the selected mark a curved A.

## Route and control inventory

The local candidate was swept at `http://127.0.0.1:4328` after the static build. `/`, `/demo`, `/developers`, `/brand`, `/login`, `/app`, `/runs/audit`, and an unknown path all rendered HTTP 200 without horizontal overflow. The private paths present the static backend boundary in rehearsal mode; they do not impersonate login or live runs.

- **Landing:** header navigation, skip link, rehearsal disclosure, `/demo` CTA, `/developers` link, receipt scenario buttons and film pause controls work. Cloud playback advances and the cloud pauses after scrolling away.
- **Rehearsal:** run, receipt expansion, boundary probe, scenario selector, reset/reload, export JSON and print are covered. Export asserts `mode: rehearsal`, exact integer accounting, no signature and a separately labeled denied probe.
- **Developers:** guide navigation and code/policy sections render without service calls.
- **Brand:** category filters, accessible preview dialog, focus return, full-size image, PNG download, ZIP download and narrow-phone layout are covered.
- **Private routes:** local controlled auth exercises password access, refresh persistence, stop, export, owner-scoped receipt and recovery. Static rehearsal routes explain that a persistent backend is required and expose no password field.
- **Unknown route:** renders the truthful missing-page/receipt shell rather than a blank page.
- **Motion controls:** each film has a named button with a 44px-class target, pauses offscreen and in a hidden tab, and disables itself under reduced motion while preserving the poster/content.

## Payment, auth, agent and MCP semantics

The payment engine remains exact-integer and policy-first. Existing tests cover catalog prices, caps, allowance arithmetic, durable reservations, idempotency, signing claims, facilitator/RPC failure handling, receipt status distinctions, auth boundaries, bounded agent execution, merchant replay and MCP stdio behavior. The browser fixture keeps the `0.020000` policy probe separate from the agent trace, and its ambiguous recovery path keeps settlement and delivery distinct without adding a fake signature or explorer link.

The audit did not run `npm run setup:operator`, enable `LIVE_PAYMENTS_ENABLED`, load a payer key, call a paid model, or send a devnet transaction. Therefore there is no real x402 transaction or paid model result to report. `npm run preflight` is read-only and currently reports these missing prerequisites:

1. operator password hash and session secret (`npm run setup:operator`);
2. explicit `LIVE_PAYMENTS_ENABLED=true` opt-in;
3. ignored dedicated devnet payer key (`PAYER_SECRET_FILE` or JSON);
4. separate merchant recipient/token owner and compatible USDC accounts;
5. trusted facilitator fee payer (`TRUSTED_FEE_PAYER`);
6. funded devnet SOL and USDC;
7. `OPENAI_API_KEY` and explicit `OPENAI_MODEL` for autonomous runs;
8. prepared `DEMO_WALLET` data for repeatable read tools.

Docker is not available in this environment, so container execution remains externally blocked. Payment Channels, mainnet and remote MCP remain deferred by scope.

## Reproducible checks

Checks run against the local candidate:

- `npm run lint` — passed.
- `npm run typecheck` — passed.
- `npm test` — **80 tests passed across 9 files**.
- `npm run build` — passed; Vite client assets: CSS `index-CWx8gozJ.css`, JS `index-Cv_VEV6F.js`.
- `npm run build:rehearsal` — passed; static assets: CSS `index-CWx8gozJ.css`, JS `index-CSL8X9GE.js`; output states no backend functions, signing or model runtime.
- `npm run test:browser` — **6 browser journeys passed**, including film/motion and deterministic recovery.
- `npm run test:hosted` — **4 local static-rehearsal journeys passed** and **4 public-production journeys passed** against `https://allowanceonsolana.vercel.app`.
- `npm run preflight` — passed as a read-only command and reported the missing live prerequisites above.
- Font checks — loaded Figtree and Geist Mono confirmed with `document.fonts.check`.
- 200% zoom — `document.documentElement.scrollWidth === innerWidth` at a 640px viewport; no horizontal overflow.

The local Vite preview used for the route sweep was `http://127.0.0.1:4328`. The normal browser harness used `http://127.0.0.1:4318` with an isolated private test database.

## Evidence

- Before baseline: [landing-desktop.png](/Users/rvaclassic/Documents/Codex/2026-09-12/files-pasted-by-the-user-build/outputs/allowance/evidence/landing-desktop.png), [rehearsal-desktop-complete.png](/Users/rvaclassic/Documents/Codex/2026-09-12/files-pasted-by-the-user-build/outputs/allowance/evidence/rehearsal-desktop-complete.png), [rehearsal-mobile-complete.png](/Users/rvaclassic/Documents/Codex/2026-09-12/files-pasted-by-the-user-build/outputs/allowance/evidence/rehearsal-mobile-complete.png).
- Repaired local candidate: [audit-after-desktop.png](/Users/rvaclassic/Documents/Codex/2026-09-12/files-pasted-by-the-user-build/outputs/allowance/evidence/audit-after-desktop.png), [audit-after-tablet.png](/Users/rvaclassic/Documents/Codex/2026-09-12/files-pasted-by-the-user-build/outputs/allowance/evidence/audit-after-tablet.png), [audit-after-mobile.png](/Users/rvaclassic/Documents/Codex/2026-09-12/files-pasted-by-the-user-build/outputs/allowance/evidence/audit-after-mobile.png), [audit-after-narrow.png](/Users/rvaclassic/Documents/Codex/2026-09-12/files-pasted-by-the-user-build/outputs/allowance/evidence/audit-after-narrow.png).
- Motion proof: [allowance-films-motion.webm](/Users/rvaclassic/Documents/Codex/2026-09-12/files-pasted-by-the-user-build/outputs/allowance/evidence/allowance-films-motion.webm), recorded from the local candidate; VP8, 1440×900, 7.48 seconds.
- Brand kit: [brand README](/Users/rvaclassic/Documents/Codex/2026-09-12/files-pasted-by-the-user-build/outputs/allowance/public/brand/README.md), [manifest](/Users/rvaclassic/Documents/Codex/2026-09-12/files-pasted-by-the-user-build/outputs/allowance/public/brand/manifest.json), [ZIP](/Users/rvaclassic/Documents/Codex/2026-09-12/files-pasted-by-the-user-build/outputs/allowance/public/brand/allowance-brand-kit.zip).

## Public status and deployment boundary

The explicitly requested production deployment is READY at [allowanceonsolana.vercel.app](https://allowanceonsolana.vercel.app), deployment `dpl_34cQeJh8x2GSUudFSeSCrMY9yeYe`, built from source commit `47c9661`. Public verification returned HTTP 200 for the repaired favicon, canonical symbol, both films and brand ZIP; `/api/health` remains HTTP 404. The response CSP keeps `connect-src 'none'` and allows only same-origin media. All nine checked public asset hashes match the local static build. The public recovery fixture preserved an interrupted run and `settled-but-result-unavailable` receipt with no external requests. The public HTML now carries the reusable product description and the demo copy explicitly names useful purchases, a separate denial and recovery. The public site remains a deterministic static rehearsal with no backend, signer or model runtime.

Deployment evidence and public screenshots are recorded in [final production deployment](/Users/rvaclassic/Documents/Codex/2026-09-12/files-pasted-by-the-user-build/outputs/allowance/evidence/production-deployment-2026-09-16-final.json) and [production recovery](/Users/rvaclassic/Documents/Codex/2026-09-12/files-pasted-by-the-user-build/outputs/allowance/evidence/production-2026-09-16-recovery.png). The earlier landing, media, console, receipt and print captures remain available under `evidence/production-2026-09-15-*`.

## Source provenance

The selected media are locally served derivatives of the supplied Axiom and Constellation sources. Provenance, poster URLs and derivative dimensions are recorded in [docs/sources.md](/Users/rvaclassic/Documents/Codex/2026-09-12/files-pasted-by-the-user-build/outputs/allowance/docs/sources.md). The implementation references the supplied A14_RED board and handoff documents; no replacement stock scenes or video screenshots were used.

## Commit and build identifiers

Baseline audit commit before the repair: `9fbac6b` (`Stabilize MCP stdio integration test`). The current implementation commit is `47c9661` (`Refresh product descriptions and rehearsal messaging`); documentation and evidence commits follow it. The reproducible build outputs are the hashes listed above; generated brand kit manifest version is `2026-09-15`.

## Remaining blockers

The implementation and controlled evidence are complete locally and the static rehearsal is deployed. The remaining blockers are external: operator/payment/model credentials and devnet funding for real x402 evidence, plus Docker availability for container checks. No simulated receipt is presented as an onchain transaction.
