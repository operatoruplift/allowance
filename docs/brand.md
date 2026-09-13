# Allowance brand — red edition

Updated September 13, 2026. Allowance is a working product name; trademark availability has not been assessed.

The current symbol is an original two-piece curved A inspired by the user's red phone reference. A rising curved stroke and smaller wedge share a baseline. It replaces the earlier ceiling-and-dot symbol. The red/paper palette and ruled editorial interface take direction from the supplied mockup. The reference phone photograph and third-party cloud/mountain films are not distributed as Allowance artwork.

The canonical source is `public/allowance-symbol.svg`. `public/allowance-wordmark.svg` and `public/favicon.svg` use the same symbol. The wordmark and downloadable SVGs contain outlined lettering so their appearance does not depend on installed fonts; edit the generator to change copy. Keep symbol proportions, clear space and the supplied contrasting color variants.

## Colors and typography

| Token     | Value     | Use                                        |
| --------- | --------- | ------------------------------------------ |
| Paper     | `#FAF7F4` | Page background                            |
| Surface   | `#FFFFFF` | Receipts and working panels                |
| Ink       | `#281E20` | Main text                                  |
| Muted     | `#6F6163` | Supporting text                            |
| Line      | `#E3D5D4` | Rules and boundaries                       |
| Brand red | `#B42336` | Logo, primary actions, selected navigation |
| Hover red | `#911A2B` | Action hover                               |
| Soft red  | `#FBECEE` | Quiet selected surfaces                    |
| Positive  | `#23734F` | Settled/delivered state markers            |
| Held      | `#96631B` | Reservations and uncertain settlement      |
| Error     | `#9F1731` | Denied/failed state markers                |

Figtree serves headings and body; Geist Mono serves IDs, technical labels and code. Both fonts are served locally with readable fallbacks and `font-display: swap`. Currency uses tabular figures. UI tokens live in `src/styles.css`; the asset generator uses matching constants. The website uses warm paper, a centered desktop masthead, a split hero with one interactive receipt, ruled feature cells, and consistent red actions. Reduced motion preserves complete visible content.

## Download library

`/brand` includes category filters, full-size previews, individual PNG/SVG downloads, color copying and the complete ZIP. The bundled manifest is `public/brand/manifest.json`. The page does not call any API or payment service.

| Category          | Assets | Sizes                                                                     |
| ----------------- | ------ | ------------------------------------------------------------------------- |
| Transparent logos | 6      | Symbols 1024 × 1024; wordmarks 1800 × 420                                 |
| Profile pictures  | 3      | 1024 × 1024, centered for circular cropping                               |
| Headers           | 3      | X 1500 × 500; LinkedIn 1584 × 396; YouTube 2560 × 1440                    |
| Wallpapers        | 5      | Three phone 1080 × 1920; two desktop 3840 × 2160                          |
| Social and ads    | 6      | Three square 1080 × 1080; two portrait 1080 × 1350; one story 1080 × 1920 |
| Backgrounds       | 3      | 1920 × 1080                                                               |

YouTube's essential logo and text fit within a centered 1546 × 423 area. Platform cropping may change; inspect each platform's own preview when uploading. All 26 designs have a full-size PNG, outlined SVG and small website preview. Transparent logo PNGs retain alpha. A contact sheet is included at `public/brand/brand-overview.png`.

On a phone, preview an asset and choose **Open full-size image**, then press and hold the PNG to save it. iPhone wording varies between Save to Photos and Save Image. Android browsers commonly offer Download image. Direct download buttons and ZIP files may save to Files or Downloads instead of Photos. Native phone save sheets were not exercised by the browser tests; the original-resolution image and download paths were tested.

## Reproduce the assets

```sh
npm ci
npx playwright install chromium
npm run brand:generate
```

`scripts/generate-brand-kit.ts` reads the canonical symbol, outlines locally bundled licensed font files with fontkit, renders PNGs with Chromium, writes the manifest and packages the ZIP with the system `zip` command. It needs no image-generation service or network access after dependencies are installed. Font files, notices and source links accompany the kit in `public/brand/fonts` and its README. Fontsource WOFF2 files and licenses for website use are in `public/fonts`.

Voice is direct and useful: a small budget, permitted tools, visible decisions, a clear receipt. The social compositions label the public rehearsal and do not assert actual settlement. USDC merchant costs, SOL fees/rent, and model costs remain separate. Brand art does not imply Solana endorsement, onchain budget enforcement or resistance to a compromised server.
