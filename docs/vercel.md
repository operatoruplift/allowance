# Vercel public rehearsal

The public rehearsal was deployed on September 12, 2026 at [allowanceonsolana.vercel.app](https://allowanceonsolana.vercel.app). This deployment hosts the landing page, deterministic rehearsal, developer guide, and an explanation of live backend requirements. It contains **no Express functions, SQLite database, development signer, OpenAI runtime, or paid merchant endpoints**. A hosted rehearsal receipt is not chain evidence. The deployment ID, source revision, public HTTP checks and matching asset hashes are saved in `evidence/vercel-deployment.json`.

On September 13, the red identity and [brand library](https://allowanceonsolana.vercel.app/brand) were published to the same address, with links to the now-public [GitHub repository](https://github.com/operatoruplift/allowance). The library serves 26 PNG/SVG compositions, previews, local fonts and a complete ZIP. All 97 deployed static files matched their local hashes, 18 public HTTP checks passed, and all four browser journeys passed against the public site in 13.7 seconds. Current deployment evidence is `evidence/brand-deployment.json`; the earlier file remains a historical record.

The complete live application remains a single persistent Express service with SQLite. Follow [live setup](live-setup.md) and the README's Docker volume instructions to operate it on a server with persistent storage. Do not configure payer keys, operator credentials, or provider keys in the Vercel project.

## Previous production deployment

On September 14, 2026, the current red Allowance build was deployed to production as `dpl_82MNDYsm16aFHG8RG6hfAWdMDnAm` and aliased to [allowanceonsolana.vercel.app](https://allowanceonsolana.vercel.app). The deployment remains the static rehearsal/brand surface; no backend, SQLite database, signer, MCP process, OpenAI key, or payment endpoint is deployed to Vercel. Four hosted browser journeys passed, `/favicon-red.svg` returned 200 as `image/svg+xml`, and the deployed static asset hashes are recorded in [production-deployment-2026-09-14.json](../evidence/production-deployment-2026-09-14.json).

## Latest production deployment

On September 15, 2026, the recovery-aware A14_RED candidate from source commit `48432f6` was promoted as `dpl_AHkuAUhTqPcLJfJXshWCG1LWfRLs`. On September 16, the final product-description and rehearsal-copy update from source commit `47c9661` was promoted as `dpl_34cQeJh8x2GSUudFSeSCrMY9yeYe` and aliased to [allowanceonsolana.vercel.app](https://allowanceonsolana.vercel.app). Four hosted browser journeys passed against the public URL, plus a public recovery check that preserved an interrupted run and `settled-but-result-unavailable` receipt without external requests. The updated metadata and demo copy are live alongside the boundary-and-dot favicon, canonical symbol, Axiom and Constellation films, posters and regenerated brand kit. Nine checked asset hashes match the local static build; `connect-src 'none'` remains enforced and `/api/health` returns 404. The deployment is still a deterministic rehearsal with no backend, signer, MCP process, OpenAI key or payment endpoint. Evidence is in [production-deployment-2026-09-16-final.json](../evidence/production-deployment-2026-09-16-final.json), [production recovery screenshot](../evidence/production-2026-09-16-recovery.png) and the prior matched public screenshots under `evidence/production-2026-09-15-*`.

The latest UI refresh from source commit `fc4f093` was promoted afterward as `dpl_wkBdsvHWKVCNDg4xA6DFuAy3ULQE` and is aliased to [allowanceonsolana.vercel.app](https://allowanceonsolana.vercel.app). It replaces the masthead and favicon URL with the cache-busted A mark, removes film pause controls, keeps local films autoplaying, improves receipt contrast, adds color and motion to the developer flow and terminals, and adds a guided `/demo` workflow. Public checks confirmed four hosted journeys, no external requests, `connect-src 'none'`, same-origin media, and no backend routes. The public network language is “Mainnet preview”; it is a no-spend static rehearsal and does not prove a mainnet settlement. Evidence is in [UI refresh deployment](../evidence/production-deployment-2026-09-16-ui-refresh.json).

## Build and publish

The static build uses Vercel's [Build Output API](https://vercel.com/docs/build-output-api/configuration). Its only outputs are `config.json` and static assets. Build-time `VITE_REHEARSAL_ONLY=true` removes the private route components from the published bundle. The build does not load `.env` files. Normal `npm run build` and `npm start` continue to build and serve the complete backend application.

```sh
npm ci
npm run build:rehearsal
npm run test:hosted
npx --yes vercel@59.16.0 link --yes --project allowanceonsolana
npx --yes vercel@59.16.0 deploy --prebuilt --prod --yes
```

Choose the intended Vercel account/team when linking; add `--scope TEAM` when necessary. The link and CLI-generated environment files remain ignored. Deploy with `--prebuilt` to upload only the prepared output. The repository's `vercel.json` also defines the rehearsal build explicitly so source builds cannot select the Express backend automatically.

API and merchant routes return 404; mutation methods return 405 where no earlier route applies. Only supported page routes receive the SPA fallback. The generated Content Security Policy permits same-origin scripts and blocks fetch/XHR connections. JSON export and print remain local browser operations.

## Verify the public site

```sh
HOSTED_REHEARSAL_URL=https://allowanceonsolana.vercel.app npm run test:hosted
```

The hosted browser tests check direct navigation to private routes without authentication/API requests, mobile layout, the fixture run and separate denied probe, exact receipt totals, no transaction signatures, JSON export and print. Brand-library journeys check category filters, dialog keyboard behavior, full-size PNGs and ZIP downloads, narrow phone layouts, and the absence of service requests. Deployment evidence is recorded separately from the original local checks. Actual devnet settlement remains pending the dedicated payer, test funding, merchant accounts, trusted sponsor, and live backend configuration.

## September 19 release

The release restores the actual two-part A across the header, browser icons and brand kit; simplifies the working example; and aligns simulated exports with their mainnet label. Persistent source now supports guarded mainnet configuration as described in [the release report](release-2026-09-19.md). This does not activate live payments on Vercel: the deployment remains static, with no backend credentials and `connect-src 'none'`. The persistent service still requires its own volume, HTTPS origin and operator setup.
