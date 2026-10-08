# Seeker and PWA readiness

Allowance includes an installable PWA and an Android WebView shell for the Solana Seeker. Browser installation and offline behavior are covered by automated Chromium checks. The debug and release builds below were run on 8 October 2026; behavior on a device and store review remain separate steps, and no on-device result is claimed here.

## What changed

- `public/site.webmanifest` now uses `display: standalone`, declares `id`, `scope`, a description, categories, shortcuts to the policy lab and console, and a new maskable icon (`public/allowance-icon-maskable-512.png`, rendered from `allowance-a.svg` on the brand background).
- `index.html` sets `viewport-fit=cover` and Android/iOS web-app metadata; `src/styles.css` pads `body` with `env(safe-area-inset-*)`.
- `public/sw.js` precaches the public HTML shell, its hashed JavaScript/CSS, fonts, and A logo for the first offline launch. Online visits refresh mutable artwork and the shell. API, merchant and tool requests bypass the cache, as do videos, ZIP/PDF downloads, and range requests. Payment data and receipt API responses are never cached. `src/main.tsx` registers it in production builds only.
- `shared/routes.ts` supplies the static and server route lists. `/demo`, `/lab`, `/privacy` and `/terms` are independent pages and support direct loads. Document CSP keeps `connect-src 'none'` on the static deployment; only `/sw.js` receives `connect-src 'self'` for public asset caching. Worker and manifest sources stay same-origin.
- The privacy policy (`/privacy`) and terms of use (`/terms`) are linked from the footer of every page, including the walkthrough, the policy lab and the console, as the dApp Store asks for a link inside the app.
- `android/` is a Solana Mobile Web Shell project (`com.operatoruplift.allowance`) wrapping the rehearsal site. It packages English resources only (see [English only](#english-only)).
- No wallet connection was added: the agent's signer is server-managed by design, so there is no user-facing signing flow to route through Mobile Wallet Adapter.

## Test on a phone (no APK needed)

1. Open https://allowanceonsolana.vercel.app in Chrome on Android or Seeker. Use the browser menu → **Install app**, or the in-page install control where one exists. On iPhone use Safari → Share → **Add to Home Screen**.
2. Launch from the home screen. The app should open full-screen with the status bar in the theme colour and content clear of the notch and gesture bar.
3. Wallet: Allowance has no user wallet flow. Verify the install, the offline shell (`/lab` works after a reload with airplane mode on) and that the console renders inside safe areas.
4. Offline: turn on airplane mode and relaunch. Static assets and the shell load from cache; live data shows its normal unavailable state rather than a browser error.

The native shell includes wallet-intent handling for a future wallet flow. The web product currently uses a server-managed payer and does not connect or request a signature from a visitor wallet.

## Known gap: downloads in the Android app

The shell has no download handler. JSON exports (walkthrough receipts and policy-lab plans) are built in the page as blob files, and brand-kit, film and transcript downloads are links with a `download` attribute. A WebView does nothing with either unless the app handles them, so inside the Android app these buttons may do nothing. Browser and installed-PWA downloads are unaffected and covered by tests. Until a native handler has been added and checked on a device, save files from the system browser.

Two pieces would close the gap. Link downloads can be handed to Android's download manager from a `DownloadListener`, limited to the app's own host. Blob exports never leave the page without a JavaScript bridge into native storage, which needs its own security review before it ships.

## Build the Android APK

The shell in `android/` was generated with `@solana-mobile/webshell-cli` and builds with its own Gradle wrapper. It wraps `https://allowanceonsolana.vercel.app/` in a WebView with native wallet-intent handling, so the deployed site is the app: redeploying the web app updates the app without a new APK.

Prerequisites: JDK 21, the Android SDK (platform 36 and build-tools 36.1.0) and `adb` to install on a device. The wrapper downloads Gradle on the first run.

```bash
export JAVA_HOME=/usr/local/opt/openjdk@21 ANDROID_HOME=$HOME/Library/Android/sdk
cd android

# Debug APK, signed with the local debug key, for a quick device check
./gradlew --no-daemon assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

### Signed release APK

The dApp Store accepts a signed release APK only. Create the release key once, outside the repository, with a key that has never been used on Google Play. Losing the keystore or its password means the app can never be updated on the dApp Store.

```bash
mkdir -p ~/keys
keytool -genkeypair -v -keystore ~/keys/allowance-release.keystore -alias allowance \
  -keyalg RSA -keysize 4096 -validity 10000
```

Build it with the passwords in the environment and the keystore path and alias as Gradle properties. `app/build.gradle.kts` reads exactly these four names:

```bash
export JAVA_HOME=/usr/local/opt/openjdk@21 ANDROID_HOME=$HOME/Library/Android/sdk
cd android
WEB_SHELL_SIGNING_STORE_PASSWORD=… WEB_SHELL_SIGNING_KEY_PASSWORD=… ./gradlew --no-daemon assembleRelease -PWEB_SHELL_SIGNING_STORE_FILE=$HOME/keys/allowance-release.keystore -PWEB_SHELL_SIGNING_KEY_ALIAS=allowance
```

> **A missing property silently produces an unsigned APK.** The release is signed only when the store file, the store password and the key alias are all set. Leave any one out and Gradle still reports success, but writes `app/build/outputs/apk/release/app-release-unsigned.apk`, which cannot be installed or submitted. Check that `app-release.apk` exists and carries your certificate:
>
> ```bash
> $ANDROID_HOME/build-tools/36.1.0/apksigner verify --print-certs app/build/outputs/apk/release/app-release.apk
> ```

`WEB_SHELL_SIGNING_KEY_PASSWORD` falls back to the store password when it is unset, which suits `keytool`'s default PKCS12 keystores, where the two are the same.

Raise `WEB_SHELL_VERSION_CODE` in `android/gradle.properties` for every release, or pass `-PWEB_SHELL_VERSION_CODE=2 -PWEB_SHELL_VERSION_NAME=1.0.1` with the build. Android installs an update only over a lower version code. The URL and application ID are set there too.

### English only

`app/build.gradle.kts` sets `androidResources { localeFilters += listOf("en") }`, and `app/src/main/res/values-en/strings.xml` declares English itself. The app has no translations; without the filter the APK declared every locale its AndroidX libraries ship. Measured with `$ANDROID_HOME/build-tools/36.1.0/aapt2 dump badging app/build/outputs/apk/debug/app-debug.apk | grep -E '^locales'`:

| Build | `locales` line | Entries |
| --- | --- | --- |
| Before the filter | `'--_--' 'af' 'am' 'ar' … 'zh-TW' 'zu'` | 86: the default `'--_--'` and 85 named locales |
| After | `'--_--' 'en'` | 2: the default and `en` |

`'--_--'` is the default configuration, which aapt2 always lists. The compiled resource table shrank from 483 KB to 34 KB. Regenerating the shell with `webshell init --force` rewrites `app/build.gradle.kts`; re-add the filter afterwards. `tests/android-shell.test.ts` fails until you do.

## Publish on the Solana dApp Store

Read the [store listing decision](#store-listing-decision) first. The listing text, banner, screenshots and reviewer notes are ready in [`docs/dapp-store/`](dapp-store/listing.md).

- **Portal:** publish at https://publish.solanamobile.com. Publishers complete KYC (individuals) or KYB (businesses) first.
- **Publisher wallet:** a desktop browser-extension app wallet, not a Ledger. It signs every release and update, so guard it like the keystore.
- **Cost:** about 0.05–0.1 SOL per release, plus ArDrive storage for the uploaded APK and media.
- **APK:** a signed release APK only, built as above with a key never used on Google Play.
- **Text:** app name up to 25 characters, subtitle up to 30.
- **Graphics:** the 512×512 icon (`public/allowance-icon-512.png`), a banner of exactly 1200×600, and 4–8 portrait screenshots of at least 1080 px.
- **Review:** about 3–5 business days.

## Store listing decision

**Recommendation: hold the store listing until a live server exists and a phone user has a reason to install the app.**

Reviewers check that an app completes its core action. Today the app opens the no-spend rehearsal: it explains and simulates guarded agent payments but cannot make one, because payments run on an operator's own server and none is deployed. Apps behind a sign-in must also give reviewers a test login, and Allowance has no public sign-up, so a reviewable live version needs a running deployment and a reviewer account on it. The kit in `docs/dapp-store/` is ready for that moment.

## Decisions to make before the first publish

- **Application ID is permanent.** This shell uses `com.operatoruplift.allowance`. Change `WEB_SHELL_APPLICATION_ID` in `android/gradle.properties` now or never.
- **Host is pinned.** The shell keeps navigation on `allowanceonsolana.vercel.app` and opens other hosts in the system browser. Moving to a custom domain later needs a rebuild but keeps the application ID.
- **Deep links.** The shell opens the start URL. To make links such as https://allowanceonsolana.vercel.app/lab or https://allowanceonsolana.vercel.app/demo open the app, add an intent filter for the host in `android/app/src/main/AndroidManifest.xml`, and serve `/.well-known/assetlinks.json` with the release key's fingerprint so Android verifies the link.
