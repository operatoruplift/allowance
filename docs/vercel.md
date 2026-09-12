# Vercel public rehearsal

The requested production address is `https://allowanceonsolana.vercel.app`. This deployment hosts the landing page, deterministic rehearsal, developer guide, and an explanation of live backend requirements. It contains **no Express functions, SQLite database, development signer, OpenAI runtime, or paid merchant endpoints**. A hosted rehearsal receipt is not chain evidence.

The complete live application remains a single persistent Express service with SQLite. Follow [live setup](live-setup.md) and the README's Docker volume instructions to operate it on a server with persistent storage. Do not configure payer keys, operator credentials, or provider keys in the Vercel project.

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

The hosted browser tests check direct navigation to private routes without authentication/API requests, mobile layout, the fixture run and separate denied probe, exact receipt totals, no transaction signatures, JSON export and print. Deployment evidence is recorded separately from the original local checks. Actual devnet settlement remains pending the dedicated payer, test funding, merchant accounts, trusted sponsor, and live backend configuration.
