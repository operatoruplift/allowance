# Allowance on the Solana dApp Store

Prepared 8 October 2026 for the [Solana dApp Publisher Portal](https://publish.solanamobile.com). Each field below is ready to paste. If you edit one, check it against the limit beside it; `tests/store-kit.test.ts` checks the name, subtitle and description limits and the assets on every run. Publishing steps, the signed release build and the store's requirements are in [docs/seeker-and-pwa.md](../seeker-and-pwa.md).

## Listing decision

**Hold the listing until a live server exists and a phone user has a reason to install the app.**

Reviewers check that an app completes its core action. Today the app opens the public rehearsal, which explains and simulates guarded agent payments but cannot make one: payments run on an operator's own server, and none is deployed. Gated apps must also give reviewers a test login, and Allowance has no public sign-up, so a reviewable live version needs a running deployment and a reviewer account on it.

When those exist, update the description and reviewer notes to describe the live flow, add the test login to the reviewer notes, and submit. One reason to list sooner is that CLOCK IN winners must list on the dApp Store to claim their prize; that call is the operator's.

## App details

### App name

Limit 25 characters. This one has 9.

```text
Allowance
```

### Subtitle

Limit 30 characters. This one has 24, the brand's headline.

```text
Give your agent a budget
```

### Description

Limit 10,000 characters. Plain text, no formatting.

```text
Allowance gives an AI agent a fixed, human-approved USDC budget on Solana, with every decision and receipt recorded.

This app opens the public Allowance site, a no-spend rehearsal. Nothing in it moves funds, calls an AI model or connects a wallet. It shows how a guarded agent budget works:

- Policy lab: set a total allowance, a per-request cap, a daily limit and the permitted tools, then see which planned requests fit and which are blocked.
- Agent walkthrough: a preloaded run in which an agent buys two paid data tools inside a 0.04 USDC allowance, is refused a third request at the limit, and recovers from a timed-out request without paying twice. Every step lands in a readable receipt.
- Developer guide and brand kit.

Real payments run on the self-hosted operator console: an Express server with a durable SQLite journal that an operator runs on their own host. It is single-operator, with no public sign-up, and the server holds its own dedicated payer key. A person approves each budget, per-request cap, tool or recipient list and expiry. Application code checks every request against that frozen policy before the payer can sign. Both payment rails, x402 purchases and direct USDC transfers to allowlisted recipients, share one daily ceiling. Each receipt keeps the hold, the submission, settlement and delivery apart, and an uncertain payment stays held until it is reconciled. A local MCP bridge lets an external agent use the same guarded payments under a scoped grant.

The limits are enforced by the application, not by onchain escrow. A host administrator or a stolen payer key can bypass them, so operators fund the payer with small amounts only. Model, facilitator and Solana network fees are separate from the USDC budget.

Allowance is open source under the MIT license: https://github.com/operatoruplift/allowance

Privacy policy: https://allowanceonsolana.vercel.app/privacy
Terms of use: https://allowanceonsolana.vercel.app/terms
```

### What’s new

```text
First release
```

### Reviewer notes

Update the last paragraph if native downloads are added to the Android shell, and add a test login here once a live deployment is listed.

```text
Allowance opens its public rehearsal at https://allowanceonsolana.vercel.app. No account, wallet or payment is needed, and nothing in the app moves funds or calls a server of ours beyond loading its pages.

Core flow, about two minutes:
1. Open the menu and tap Policy lab. Change Total allowance to 0.010000 and watch the planned requests switch from allowed to blocked.
2. From the home page, tap Open walkthrough, then Run walkthrough. When the brief appears, tap Test the boundary: the third request is denied before signing. Tap Receipt to see every decision.
3. The privacy policy and terms of use are linked in the footer of every page.

The Operator access and console pages explain the self-hosted backend. In this app they do not sign in or call a server. The app needs internet access only and connects no wallet.

Known limitation: file downloads (receipt JSON, brand assets) do not save from inside the app. Use the system browser to save them.
```

## Links and contact

| Field | Value |
| --- | --- |
| Website | https://allowanceonsolana.vercel.app |
| Privacy policy | https://allowanceonsolana.vercel.app/privacy |
| Terms of use (EULA) | https://allowanceonsolana.vercel.app/terms |
| Support email | Set in the Portal |
| Contact email | Set in the Portal |

The legal pages show a support email only when the site is built with `VITE_SUPPORT_EMAIL`; otherwise they point to the GitHub issue tracker. If you enter a support email in the Portal, set the same address as a Vercel build variable and redeploy, so the app and the listing agree.

## Store details

| Field | Value |
| --- | --- |
| Languages | English (the APK declares `en` only) |
| Token distribution | No |
| Copyright | © 2026 Operator Uplift |
| Countries | All, excluding sanctioned countries |
| Category | Finance, matching the web manifest |
| Package | `com.operatoruplift.allowance` |

## Graphics

| Asset | File | Size |
| --- | --- | --- |
| Icon | [`public/allowance-icon-512.png`](../../public/allowance-icon-512.png) | 512 × 512 |
| Banner | [`banner-1200x600.png`](banner-1200x600.png), composed in [`banner.html`](banner.html) | 1200 × 600 |
| Screenshot 1 | [`screenshots/01-landing.png`](screenshots/01-landing.png): the home page | 1080 × 1920 |
| Screenshot 2 | [`screenshots/02-policy-lab.png`](screenshots/02-policy-lab.png): the policy lab after lowering the allowance, one request fits and two are blocked | 1080 × 1920 |
| Screenshot 3 | [`screenshots/03-walkthrough-running.png`](screenshots/03-walkthrough-running.png): the walkthrough mid-run, the first purchase held | 1080 × 1920 |
| Screenshot 4 | [`screenshots/04-walkthrough-receipt.png`](screenshots/04-walkthrough-receipt.png): the completed receipt, the third request denied | 1080 × 1920 |
| Screenshot 5 | [`screenshots/05-developers.png`](screenshots/05-developers.png): the developer guide | 1080 × 1920 |
| Screenshot 6 | [`screenshots/06-console.png`](screenshots/06-console.png): the console workspace, waiting for an operator backend | 1080 × 1920 |

Screenshots are captured from the live site at a 360 × 640 viewport, device scale 3, with phone emulation and the service worker blocked. Regenerate the banner and screenshots after the site changes, and check the output by eye before uploading:

```bash
npx playwright install chromium
npm run store:kit                      # banner and screenshots
npm run store:kit -- --banner          # banner only
STORE_KIT_URL=https://<deployment> npm run store:kit -- --screenshots
```

The script fails if any file is the wrong size, a screenshot reaches 3 MB, or the brand fonts did not load.

## Before you submit

- [ ] A live deployment exists and the reviewer notes include a test login (see the listing decision)
- [ ] The operator's legal name and jurisdiction are confirmed in the terms and privacy policy, and a lawyer has reviewed both
- [ ] Support email set in the Portal and, if used, as `VITE_SUPPORT_EMAIL` for the site build
- [ ] Signed release APK built and checked with `apksigner verify`, version code raised for each update
- [ ] Publisher wallet holds enough SOL for the release and ArDrive storage
- [ ] Screenshots regenerated if the site changed since 8 October 2026
