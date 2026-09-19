# Allowance brand kit — red edition

26 original compositions, each in PNG and outlined SVG. All symbols derive from the canonical two-part curved A mark. SVG lettering is outlined, so it stays consistent without installing fonts. Transparent logo PNGs preserve alpha; put the white versions on a dark background.

## Save an image to your phone

- On the website, preview the asset and choose **Open full-size image**.
- On iPhone, press and hold the image, then choose Save to Photos or Save Image. Available wording depends on iOS and the browser.
- On Android, press and hold and choose Download image. Your browser may save it to Downloads first.
- A Download PNG button or the ZIP may save to Files rather than Photos. Unzip the kit in Files and use the share sheet to save individual images where your device supports it.
- SVG files are editable vector source. PNG files are ready for social-media uploads.

## Contents

- Logos: transparent red, white and ink symbols and wordmarks.
- Profiles: 1024 × 1024 red, paper and ink avatars; centered for circular crops.
- Headers: X 1500 × 500, LinkedIn 1584 × 396, YouTube 2560 × 1440. YouTube's essential logo and copy sit in the central 1546 × 423 area. Platform interfaces and crops can change; check the platform's preview before saving your profile.
- Wallpapers: three 1080 × 1920 phone versions and two 3840 × 2160 desktop versions.
- Social: three 1080 × 1080 posts, two 1080 × 1350 portrait posts and one 1080 × 1920 story.
- Backgrounds: three text-free 1920 × 1080 compositions.

## Color and typography

Brand red #B42336; paper #FAF7F4; ink #281E20; muted #6F6163; line #E3D5D4; soft red #FBECEE.
Figtree 600 for the wordmark and headlines; Figtree 400 for supporting copy; Geist Mono 500 for labels.

Keep the logo's proportions and leave clear space around it. Use the supplied contrasting versions. The social designs describe Allowance's public rehearsal; no real payment, verified settlement or Solana endorsement is claimed.

## Font source and licenses

The included original font files are distributed under their accompanying SIL Open Font Licenses. They were obtained from the official Google Fonts repository:
- https://github.com/google/fonts/tree/main/ofl/figtree
- https://github.com/google/fonts/tree/main/ofl/geistmono

The application uses WOFF2 versions of these families. The generator uses the original variable TTF files because fontkit 2.0.4 cannot apply variations reliably to WOFF2 fonts. No network access is needed to regenerate the kit.

Run **npm run brand:generate** in the source repository after installing dependencies and Playwright Chromium. The generator reads the canonical SVG, outlines the locally licensed fonts, exports PNGs with Chromium, writes the manifest and packages this ZIP. Generated composition source is in **scripts/generate-brand-kit.ts**.
