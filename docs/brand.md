# Allowance brand — material edition

Updated September 23, 2026. Allowance is a working product name; trademark availability has not been assessed.

The current symbol is the user's requested two-part curved A, restored from the original vector artwork. The curved left stroke and separate triangular right stroke match the supplied red logo reference. This supersedes the boundary-and-dot mark in the earlier design handoff. The red/paper palette and ruled editorial interface remain. The September 23 downloadable collection replaces the flat geometry campaign templates with three material studies: tactile red sculpture, monumental architecture under an open sky, and ivory paper folds. The art is expressive; the canonical logo remains exact. The selected cloud and mountain films are included as locally served, documented derivatives of the supplied sources.

The canonical source is `public/allowance-symbol.svg`. The header/footer alias `public/allowance-a.svg`, wordmark, SVG/PNG favicons, Apple touch icon, web manifest icons, social sharing image and downloadable kit use the same symbol. Browser icon URLs are versioned to replace cached artwork. The wordmark and downloadable SVGs contain outlined lettering so their appearance does not depend on installed fonts; edit the generator to change copy. Campaign SVGs contain embedded JPEG art plates with vector logo and type overlays; they are self-contained mixed-media compositions, not wholly vector illustrations. Keep symbol proportions, clear space and the supplied contrasting color variants.

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

Figtree 650 gives the campaign headlines their weight; the wordmark remains Figtree 600. Figtree serves headings and body; Geist Mono serves IDs, technical labels and code. Both fonts are served locally with readable fallbacks and `font-display: swap`. Currency uses tabular figures. UI tokens live in `src/styles.css`; the asset generator uses matching constants. The website uses warm paper, a centered desktop masthead, a split hero with one interactive receipt, ruled feature cells, and consistent red actions. Reduced motion preserves complete visible content.

## Download library

`/brand` presents a curated collection with large artwork previews, category filters, individual PNG/SVG downloads, color copying and the complete ZIP. Asset IDs and download paths are preserved so existing links continue to work; the website versions refreshed image URLs. The bundled manifest is `public/brand/manifest.json`. The page does not call any API or payment service.

| Category          | Assets | Sizes                                                                     |
| ----------------- | ------ | ------------------------------------------------------------------------- |
| Transparent logos | 6      | Symbols 1024 × 1024; wordmarks 1800 × 420                                 |
| Profile pictures  | 3      | 1024 × 1024, softly lit material surfaces centered for circular cropping  |
| Headers           | 3      | X 1500 × 500; LinkedIn 1584 × 396; YouTube 2560 × 1440                    |
| Wallpapers        | 5      | Three phone 1080 × 1920; two desktop 3840 × 2160                          |
| Social and ads    | 6      | Three square 1080 × 1080; two portrait 1080 × 1350; one story 1080 × 1920 |
| Backgrounds       | 3      | 1920 × 1080                                                               |

YouTube's essential logo and text fit within a centered 1546 × 423 area. Platform cropping may change; inspect each platform's own preview when uploading. All 26 designs have a full-size PNG, self-contained SVG and small website preview. The two desktop PNGs have 3840 × 2160 output dimensions; their embedded raster masters have lower native resolution. Outlined typography and canonical marks remain sharp at the chosen export dimensions. Transparent logo PNGs retain alpha. A contact sheet is included at `public/brand/brand-overview.png`.

On a phone, preview an asset and choose **Open full-size image**, then press and hold the PNG to save it. iPhone wording varies between Save to Photos and Save Image. Android browsers commonly offer Download image. Direct download buttons and ZIP files may save to Files or Downloads instead of Photos. Native phone save sheets were not exercised by the browser tests; the original-resolution image and download paths were tested.

## Art direction and source

- **Red sculpture:** tactile crimson forms and deep shadow. The phone wallpaper leaves the top clock area quiet; the desktop edition leaves a continuous deep-red field for icons. Social typography is large, short and white.
- **Open sky:** red architecture under warm skies, with generous negative space. Headers keep platform overlap areas quiet and place essential text on readable surfaces. Feed layouts pair large editorial type with landscape artwork.
- **Paper study:** ivory folds, a red accent and strong contrast. Paper serves as a material, not a repeated card template. The ink phone edition presents the image like a gallery print.

The four visual plates were generated with OpenAI image generation on September 23, 2026 for this collection. They depict imagined materials and architecture, not photographs of real objects or places. The canonical vector A and typography are overlaid by the local generator. `public/brand/art/provenance.json` and `public/brand/art/wide-provenance.json` record source prompts and export details; the ZIP includes that record and the JPEG masters.

The source raster sizes are 1024 × 1536 for sculpture and paper, and 1672 × 941 for sky and wide sculpture. The generator embeds the supplied JPEG bytes without external requests. Larger PNG canvas dimensions are not a claim of additional native photographic detail. AI-generated art should not be assumed to have exclusive copyright protection or a third-party stock-photo license; these are project assets intended for Allowance branding. Font licenses remain applicable. The pre-existing cloud and mountain film provenance is separate and unchanged.

## Reproduce the assets

```sh
npm ci
npx playwright install chromium
npm run brand:generate
```

`scripts/generate-brand-kit.ts` reads the canonical symbol and saved art plates, outlines locally bundled licensed font files with fontkit, renders PNGs with Chromium, writes the manifest and packages the ZIP with the system `zip` command. It needs no image-generation service or network access after dependencies are installed. The six transparent logo exports remain pure vector compositions. The art masters are already saved locally and included in the ZIP. Font files, notices and source links accompany the kit in `public/brand/fonts` and its README. Fontsource WOFF2 files and licenses for website use are in `public/fonts`.

Voice is direct and useful: a small budget, permitted tools, visible decisions, a clear receipt. The social compositions label the public rehearsal and do not assert actual settlement. USDC merchant costs, SOL fees/rent, and model costs remain separate. Brand art does not imply Solana endorsement, onchain budget enforcement or resistance to a compromised server.
