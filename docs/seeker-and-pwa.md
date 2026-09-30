# Seeker and PWA readiness

Allowance includes an installable PWA and an Android WebView shell for the Solana Seeker. Browser installation and offline behavior are covered by automated Chromium checks. Native APK, device, and store validation remain separate steps; no on-device result is claimed here.

## What changed

- `public/site.webmanifest` now uses `display: standalone`, declares `id`, `scope`, a description, categories, shortcuts to the policy lab and console, and a new maskable icon (`public/allowance-icon-maskable-512.png`, rendered from `allowance-a.svg` on the brand background).
- `index.html` sets `viewport-fit=cover` and Android/iOS web-app metadata; `src/styles.css` pads `body` with `env(safe-area-inset-*)`.
- `public/sw.js` precaches the public HTML shell, its hashed JavaScript/CSS, fonts, and A logo for the first offline launch. Online visits refresh mutable artwork and the shell. API, merchant and tool requests bypass the cache, as do videos, ZIP/PDF downloads, and range requests. Payment data and receipt API responses are never cached. `src/main.tsx` registers it in production builds only.
- `shared/routes.ts` supplies the static and server route lists. Both `/demo` and `/lab` are independent pages and support direct loads. Document CSP keeps `connect-src 'none'` on the static deployment; only `/sw.js` receives `connect-src 'self'` for public asset caching. Worker and manifest sources stay same-origin.
- `android/` is a Solana Mobile Web Shell project (`com.operatoruplift.allowance`) wrapping the rehearsal site.
- No wallet connection was added: the agent's signer is server-managed by design, so there is no user-facing signing flow to route through Mobile Wallet Adapter.

## Test on a phone (no APK needed)

1. Open https://allowanceonsolana.vercel.app in Chrome on Android or Seeker. Use the browser menu → **Install app**, or the in-page install control where one exists. On iPhone use Safari → Share → **Add to Home Screen**.
2. Launch from the home screen. The app should open full-screen with the status bar in the theme colour and content clear of the notch and gesture bar.
3. Wallet: Allowance has no user wallet flow. Verify the install, the offline shell (`/lab` works after a reload with airplane mode on) and that the console renders inside safe areas.
4. Offline: turn on airplane mode and relaunch. Static assets and the shell load from cache; live data shows its normal unavailable state rather than a browser error.

The native shell includes wallet-intent handling for a future wallet flow. The web product currently uses a server-managed payer and does not connect or request a signature from a visitor wallet.

## Native download limitation

The current Android shell has no download listener or blob-export bridge. Browser/PWA JSON exports and brand downloads are tested separately; do not assume they work inside the native WebView. Use the system browser for saving files until a native download implementation has been added and verified on a device. Native file saving is an outstanding Android integration task.

## Build the Android APK

The shell in `android/` was generated with `@solana-mobile/webshell-cli`, which the Solana Mobile docs now recommend over Bubblewrap. It wraps `https://allowanceonsolana.vercel.app/` in a WebView with native wallet-intent handling, so the deployed site is the app: redeploying the web app updates the app without a new APK.

Prerequisites: Node 24+, `adb`, and about 2 GB of disk for the Android SDK. The CLI installs a managed JDK 17 and the SDK packages it needs on the first `build` (`doctor --fix` does the same without building).

```bash
npm install -g @solana-mobile/webshell-cli
cd android

# First build only: choose a release keystore. The CLI creates it if the file
# does not exist. Keep it and its passwords outside the repo; losing it means
# you can never update the app on the dApp Store.
export WEB_SHELL_KEYSTORE_PASSWORD='...'
export WEB_SHELL_KEY_PASSWORD='...'
webshell build . --keystore-path ~/keys/allowance-release.keystore --keystore-alias allowance

adb install -r app/build/outputs/apk/release/app-release.apk
```

Bump `--version-code` on every release (`webshell init . --force --version-code 2 --version-name 1.1.0` rewrites `gradle.properties`; the URL, id and icons are already recorded in `twa-manifest.json`).

## Publish on the Solana dApp Store

Winners must list on the dApp Store to claim CLOCK IN prizes, and the listing is the distribution channel for every Seeker owner.

- Register at the Publisher Portal (https://docs.solanamobile.com/dapp-publishing/intro): KYC/KYB, and a publisher wallet holding about 0.2 SOL. That wallet signs every future update, so treat it like the keystore.
- Signing key: a **new** key never used on Google Play. The keystore above qualifies.
- Assets: the 512×512 icon (`icons/icon-512.png` or equivalent here), a 1200×600 banner, and at least four phone screenshots.
- Submit the release APK; review currently takes 3–5 business days. Updates go through the `dapp-store` CLI with the same publisher wallet.

## Decisions to make before the first publish

- **Application ID is permanent.** This shell uses `com.operatoruplift.allowance`. Change it now (`webshell init . --force --application-id ...`) or never.
- **Host is pinned.** The shell keeps navigation on `allowanceonsolana.vercel.app` and opens other hosts in the system browser. Moving to a custom domain later needs a rebuild but keeps the application ID.
- **Deep links.** The shell opens the start URL; if you want `/rwa?mint=...`-style links to open the app, add an intent filter for the host in `android/app/src/main/AndroidManifest.xml`.

## CLOCK IN checklist (Solana Mobile × RadiantsDAO, closes 8 October 2026)

- [ ] Release APK built with the steps above and installed on a Seeker or Android device
- [ ] Public GitHub repo (this one), with this branch merged
- [ ] Demo video showing the install, policy lab, and actual supported flow on a phone
- [ ] Pitch deck: problem, product, why mobile-first, traction, team
- [ ] Optional SKR integration for the separate $10K SKR prize
