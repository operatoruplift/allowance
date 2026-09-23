# Allowance brand kit — material edition

26 finished compositions in PNG and self-contained SVG. Three original art collections: Red sculpture, Open sky and Paper study. All symbols derive from the canonical two-part curved A mark. The six transparent logo files preserve pure vector geometry. Campaign SVGs combine embedded JPEG art with outlined vector lettering and logos; they are not entirely vector illustrations.

## Save an image to your phone

- Preview an asset on the website and choose **Open full-size image**.
- On iPhone, press and hold the image, then choose Save to Photos or Save Image. Wording depends on the browser and iOS version.
- On Android, press and hold and choose Download image. Your browser may save it to Downloads first.
- Download PNG and ZIP buttons may save to Files rather than Photos. Unzip the kit in Files and use the share sheet to save images where your device supports it.
- PNG files are ready for social uploads. Self-contained SVGs retain the exact vector logo and type, and include the raster art without external requests.

## Contents

- Logos: six transparent red, white and ink symbols and wordmarks. White versions need a dark backdrop.
- Profiles: three 1024 × 1024 material editions, centered for circular crops.
- Headers: X 1500 × 500, LinkedIn 1584 × 396, YouTube 2560 × 1440. YouTube's essential logo and copy sit in the central 1546 × 423 area. Check each platform's preview before uploading; interfaces and crops can change.
- Wallpapers: three 1080 × 1920 phone canvases and two 3840 × 2160 desktop canvases. Desktop exports have 4K output dimensions; the embedded original raster masters have lower native resolution, recorded below.
- Social: three 1080 × 1080 posts, two 1080 × 1350 portraits and one 1080 × 1920 story. Rehearsal copy never claims an actual payment.
- Backgrounds: three text-free 1920 × 1080 art compositions.
- Original art plates, generation provenance, local fonts, font notices and this guide.

## Materials, color and typography

Red sculpture uses tactile red forms and deep shadow. Open sky uses monumental red architecture, warm light and open space. Paper study uses ivory folds, a red accent and strong editorial typography. Wallpapers keep advertising copy out of the way; campaign layouts use a deliberately short headline.

Brand red #B42336; paper #FAF7F4; ink #281E20; muted #6F6163; line #E3D5D4; soft red #FBECEE.
Figtree 600 for the wordmark, Figtree 650 for campaign headlines, Figtree 400 for supporting copy, and Geist Mono 500 for labels.

Keep the logo's proportions and clear space. Use supplied contrasting variants. The designs do not assert real settlement, audited security, onchain policy enforcement or Solana endorsement.

## Art source and usage

The four art plates were created with OpenAI image generation for this Allowance collection on September 23, 2026. They depict imagined materials and architecture, not photographs of real places or products. The source prompts, export sizes and encoding details are in art/provenance.json and art/wide-provenance.json. The canonical A and exact typography were applied separately by the local generator.

JPEG masters: sculpture.jpg 1024 × 1536; sculpture-wide.jpg 1672 × 941; sky.jpg 1672 × 941; paper.jpg 1024 × 1536. They are embedded unchanged in the composition SVGs. Exporting a larger PNG canvas does not add native photographic detail. AI-generated visual material should not be assumed to carry exclusive copyright rights or a third-party stock-photo license. These project assets are provided for use in Allowance branding; accompanying font licenses remain applicable. No outside brand or platform endorsement is claimed.

## Font source and licenses

The original font files are distributed under their accompanying SIL Open Font Licenses, obtained from the official Google Fonts repository:
- https://github.com/google/fonts/tree/main/ofl/figtree
- https://github.com/google/fonts/tree/main/ofl/geistmono

The application uses WOFF2 versions. The asset generator uses original variable TTF files for reliable local fontkit variation support.

## Regenerate

Run **npm run brand:generate** after installing dependencies and Playwright Chromium. The generator reads the canonical SVG and saved JPEG masters, outlines local fonts, exports PNGs with Chromium, writes the catalog and packages the ZIP. Regeneration does not call any image-generation service or access the network. Composition source lives in **scripts/generate-brand-kit.ts**.
