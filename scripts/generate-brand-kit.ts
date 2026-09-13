import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { openSync, type Font } from 'fontkit';
import { chromium } from '@playwright/test';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'public/brand');
const runFile = promisify(execFile);
const red = '#B42336';
const paper = '#FAF7F4';
const ink = '#281E20';
const soft = '#FBECEE';
const muted = '#6F6163';
const line = '#E3D5D4';
const symbol = await fs.readFile(path.join(root, 'public/allowance-symbol.svg'), 'utf8');
const symbolPaths = [...symbol.matchAll(/<path\s+d="([^"]+)"\s*\/?\s*>/g)].map((match) => match[1]);
if (symbolPaths.length !== 2 || !symbol.includes('viewBox="0 0 256 256"')) {
  throw new Error('Expected the canonical 256 × 256 Allowance symbol with two paths.');
}

function font(file: string, weight: number) {
  const loaded = openSync(path.join(output, 'fonts', file));
  if (!('layout' in loaded)) throw new Error('A single font file is required.');
  return loaded.getVariation({ wght: weight });
}
const display = font('Figtree-Variable.ttf', 600);
const regular = font('Figtree-Variable.ttf', 400);
const mono = font('GeistMono-Variable.ttf', 500);

function escape(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!
  );
}

/** Outline font glyphs so exported SVGs need neither remote nor installed fonts. */
function text(
  value: string,
  x: number,
  y: number,
  size: number,
  color = ink,
  face: Font = display,
  tracking = 0,
  anchor: 'start' | 'middle' | 'end' = 'start'
) {
  const run = face.layout(value);
  const scale = size / face.unitsPerEm;
  const width =
    run.positions.reduce((total, position) => total + position.xAdvance * scale, 0) +
    Math.max(0, run.glyphs.length - 1) * tracking;
  const offset = anchor === 'middle' ? width / 2 : anchor === 'end' ? width : 0;
  let cursor = 0;
  const paths = run.glyphs
    .map((glyph, index) => {
      const position = run.positions[index];
      const outline = glyph.path.toSVG();
      const shape = outline
        ? `<path transform="translate(${cursor + position.xOffset} ${position.yOffset})" d="${outline}"/>`
        : '';
      cursor += position.xAdvance + tracking / scale;
      return shape;
    })
    .join('');
  return `<g fill="${color}" aria-label="${escape(value)}" transform="translate(${x - offset} ${y}) scale(${scale} ${-scale})">${paths}</g>`;
}

function mark(x: number, y: number, size: number, color: string, opacity = 1) {
  return `<g fill="${color}" opacity="${opacity}" transform="translate(${x} ${y}) scale(${size / 256})">${symbolPaths.map((d) => `<path d="${d}"/>`).join('')}</g>`;
}
function lockup(x: number, y: number, width: number, color: string) {
  return `<g transform="translate(${x} ${y}) scale(${width / 1024})">${mark(0, 0, 224, color)}${text('Allowance.', 280, 166, 147, color)}</g>`;
}
function rule(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
  opacity = 1,
  width = 1
) {
  return `<path d="M${x1} ${y1}L${x2} ${y2}" stroke="${color}" stroke-width="${width}" opacity="${opacity}"/>`;
}
function ring(x: number, y: number, radius: number, color: string, opacity = 1, width = 1) {
  return `<circle cx="${x}" cy="${y}" r="${radius}" fill="none" stroke="${color}" stroke-width="${width}" opacity="${opacity}"/>`;
}
function label(
  value: string,
  x: number,
  y: number,
  color: string,
  size = 16,
  anchor: 'start' | 'middle' | 'end' = 'start'
) {
  return text(value, x, y, size, color, mono, 1.5, anchor);
}
function lines(
  values: string[],
  x: number,
  y: number,
  size: number,
  color: string,
  leading = 1.02,
  face: Font = display
) {
  return values
    .map((value, index) => text(value, x, y + index * size * leading, size, color, face))
    .join('');
}

type Category = 'logos' | 'profiles' | 'wallpapers' | 'headers' | 'social' | 'backgrounds';
type Asset = {
  id: string;
  title: string;
  description: string;
  category: Category;
  width: number;
  height: number;
  preview: string;
  png: string;
  svg: string;
  background: string;
};
type Composition = { asset: Asset; source: string };
const compositions: Composition[] = [];

function add(
  id: string,
  title: string,
  description: string,
  category: Category,
  width: number,
  height: number,
  background: string | null,
  artwork: string,
  previewBackground = background ?? paper
) {
  const source = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img"><title>${escape(title)} — Allowance</title><desc>${escape(description)} Original Allowance artwork. Typography outlined from OFL-licensed Figtree and Geist Mono.</desc>${background ? `<rect width="${width}" height="${height}" fill="${background}"/>` : ''}${artwork}</svg>`;
  compositions.push({
    source,
    asset: {
      id,
      title,
      description,
      category,
      width,
      height,
      preview: `/brand/previews/${id}.png`,
      png: `/brand/${category}/${id}.png`,
      svg: `/brand/${category}/${id}.svg`,
      background: previewBackground,
    },
  });
}

for (const [name, color, backdrop] of [
  ['red', red, paper],
  ['white', '#FFFFFF', red],
  ['ink', ink, paper],
]) {
  add(
    `symbol-${name}`,
    `The symbol · ${name}`,
    'Transparent background. The original curved Allowance mark, ready for your own layouts.',
    'logos',
    1024,
    1024,
    null,
    mark(0, 0, 1024, color),
    backdrop
  );
  add(
    `wordmark-${name}`,
    `The wordmark · ${name}`,
    'Transparent background. Outlined lettering keeps the logo consistent on every device.',
    'logos',
    1800,
    420,
    null,
    lockup(50, 25, 1700, color),
    backdrop
  );
}

for (const [name, background, foreground] of [
  ['red', red, paper],
  ['paper', paper, red],
  ['ink', ink, paper],
]) {
  add(
    `profile-${name}`,
    `Profile picture · ${name}`,
    'A centered mark with generous room for circular profile crops. Made for social avatars.',
    'profiles',
    1024,
    1024,
    background,
    mark(197, 197, 630, foreground)
  );
}

add(
  'header-x-red',
  'X header · a clear limit',
  'Wide header with the lower-left profile overlap kept quiet. Keep text within the supplied composition.',
  'headers',
  1500,
  500,
  red,
  ring(190, 380, 345, paper, 0.18) +
    ring(190, 380, 245, paper, 0.15) +
    lockup(525, 88, 510, paper) +
    lines(['A little independence.', 'A clear limit.'], 544, 279, 58, paper, 1.13) +
    label('AGENT AUTONOMY. WITH AN ALLOWANCE.', 548, 437, paper, 13) +
    mark(1220, 111, 224, paper, 0.13)
);
add(
  'header-linkedin-paper',
  'LinkedIn header · agent autonomy',
  'A clean wide composition. The profile-photo area on the left stays free of essential text.',
  'headers',
  1584,
  396,
  paper,
  rule(450, 56, 1514, 56, line, 1, 2) +
    lockup(456, 82, 400, red) +
    text('Give your agent a budget.', 460, 260, 58, ink) +
    label('USEFUL TOOLS. CLEAR BOUNDARIES.', 464, 330, muted, 13) +
    mark(1220, 84, 215, red, 0.14) +
    ring(205, 325, 250, red, 0.15)
);
add(
  'header-youtube-ink',
  'YouTube banner · the allowance',
  'Core logo and message sit inside the central 1546 × 423 area for small-screen crops.',
  'headers',
  2560,
  1440,
  ink,
  ring(2170, 870, 900, paper, 0.13, 2) +
    ring(2170, 870, 630, paper, 0.1, 2) +
    mark(-165, 330, 810, red, 0.6) +
    lockup(656, 570, 740, paper) +
    text('A little independence. A clear limit.', 674, 844, 59, paper) +
    label('AGENT AUTONOMY. WITH AN ALLOWANCE.', 675, 908, paper, 19)
);

for (const [name, background, foreground, accent] of [
  ['red', red, paper, paper],
  ['paper', paper, red, ink],
  ['ink', ink, paper, red],
]) {
  add(
    `wallpaper-phone-${name}`,
    `Phone wallpaper · ${name}`,
    'A calm top third leaves room for your clock. The curved mark sits below the lock-screen controls.',
    'wallpapers',
    1080,
    1920,
    background,
    ring(965, 1035, 635, foreground, 0.16, 2) +
      ring(965, 1035, 420, foreground, 0.12, 2) +
      mark(206, 690, 660, foreground) +
      label('A LITTLE INDEPENDENCE.', 540, 1450, accent, 20, 'middle') +
      label('A CLEAR LIMIT.', 540, 1490, accent, 20, 'middle') +
      rule(100, 1680, 980, 1680, foreground, 0.25, 2) +
      label('ALLOWANCE', 100, 1730, foreground, 16) +
      label('ROOM TO DO USEFUL THINGS.', 980, 1730, foreground, 14, 'end')
  );
}
for (const [name, background, foreground, accent] of [
  ['red', red, paper, paper],
  ['paper', paper, red, ink],
]) {
  add(
    `wallpaper-desktop-${name}`,
    `Desktop wallpaper · ${name}`,
    '4K artwork with a quiet left side for desktop icons and a generous, graphic right side.',
    'wallpapers',
    3840,
    2160,
    background,
    ring(3060, 1150, 1010, foreground, 0.15, 3) +
      ring(3060, 1150, 740, foreground, 0.1, 3) +
      mark(2520, 510, 1130, foreground) +
      lockup(220, 230, 720, foreground) +
      lines(['A little independence.', 'A clear limit.'], 242, 1460, 170, accent, 1.15) +
      rule(240, 1900, 3600, 1900, foreground, 0.3, 3) +
      label('ALLOWANCE / AGENT AUTONOMY', 246, 1980, foreground, 29) +
      label('ROOM TO DO USEFUL THINGS.', 3600, 1980, foreground, 27, 'end')
  );
}

function socialFooter(height: number, color: string, backgroundLine: string) {
  return (
    rule(70, height - 138, 1010, height - 138, backgroundLine, 0.42, 2) +
    label('PUBLIC REHEARSAL · NO REAL PAYMENTS', 72, height - 90, color, 14) +
    label('ALLOWANCEONSOLANA.VERCEL.APP', 72, height - 57, color, 12)
  );
}
add(
  'social-square-budget',
  'Square post · give it a budget',
  'Launch artwork for a social feed. Describes the public rehearsal without claiming a live payment.',
  'social',
  1080,
  1080,
  red,
  lockup(65, 57, 370, paper) +
    lines(['Give your agent', 'a budget.'], 73, 310, 100, paper, 1.04) +
    mark(532, 437, 433, paper) +
    label('A LITTLE INDEPENDENCE.', 75, 669, paper, 14) +
    label('A CLEAR LIMIT.', 75, 698, paper, 14) +
    socialFooter(1080, paper, paper)
);
add(
  'social-square-policy',
  'Square post · the policy decides',
  'A strong editorial message for a feed post or square ad.',
  'social',
  1080,
  1080,
  paper,
  lockup(65, 57, 370, red) +
    label('AGENT AUTONOMY. WITH AN ALLOWANCE.', 75, 248, muted, 15) +
    lines(['The model asks.', 'The policy', 'decides.'], 73, 409, 110, ink, 1.06) +
    rule(77, 672, 594, 672, red, 1, 9) +
    mark(726, 705, 230, red) +
    socialFooter(1080, muted, line)
);
add(
  'social-square-receipt',
  'Square post · a clear receipt',
  'An expressive brand post about spending limits and readable records. No transaction stats.',
  'social',
  1080,
  1080,
  ink,
  lockup(65, 57, 370, paper) +
    lines(['A small budget.', 'A clear receipt.'], 72, 361, 99, paper, 1.09) +
    `<rect x="715" y="586" width="280" height="284" rx="4" fill="${paper}"/>` +
    mark(784, 620, 143, red) +
    rule(757, 800, 953, 800, line, 1, 3) +
    rule(757, 824, 899, 824, line, 1, 3) +
    label('EVERY DECISION', 75, 730, paper, 18) +
    label('LEAVES A RECORD.', 75, 767, paper, 18) +
    socialFooter(1080, paper, paper)
);
add(
  'social-portrait-budget',
  'Portrait post · room to act',
  'A 4:5 feed or ad layout with the message and brand comfortably inside the canvas.',
  'social',
  1080,
  1350,
  paper,
  lockup(65, 65, 380, red) +
    label('USEFUL AGENTS. CLEAR BOUNDARIES.', 74, 267, muted, 16) +
    lines(['Give your', 'agent a', 'budget.'], 65, 418, 140, ink, 1.0) +
    `<rect x="687" y="710" width="315" height="381" rx="4" fill="${red}"/>` +
    mark(720, 774, 253, paper) +
    lines(
      ['Let it buy the tools it needs.', 'See where every cent went.'],
      76,
      919,
      33,
      muted,
      1.5,
      regular
    ) +
    socialFooter(1350, muted, line)
);
add(
  'social-portrait-policy',
  'Portrait post · the boundary',
  'A 4:5 red edition of the core policy message. Ready for a feed post or ad.',
  'social',
  1080,
  1350,
  red,
  lockup(65, 65, 380, paper) +
    lines(['The model', 'asks.', 'The policy', 'decides.'], 70, 356, 117, paper, 1.07) +
    ring(950, 976, 233, paper, 0.3, 2) +
    mark(775, 851, 264, paper) +
    label('INDEPENDENCE, WITHIN REACH.', 75, 1034, paper, 17) +
    socialFooter(1350, paper, paper)
);
add(
  'social-story-budget',
  'Story · a little independence',
  'Vertical story artwork with the central message clear of common top and bottom interface controls.',
  'social',
  1080,
  1920,
  red,
  lockup(69, 290, 405, paper) +
    lines(['Give your', 'agent a', 'budget.'], 76, 617, 142, paper, 1.03) +
    mark(566, 1000, 410, paper) +
    label('USEFUL TOOLS.', 80, 1260, paper, 20) +
    label('CLEAR CONTROL.', 80, 1302, paper, 20) +
    rule(80, 1542, 1000, 1542, paper, 0.4, 2) +
    label('PUBLIC REHEARSAL · NO REAL PAYMENTS', 80, 1599, paper, 17) +
    label('ALLOWANCEONSOLANA.VERCEL.APP', 80, 1639, paper, 16)
);

for (const [name, background, foreground] of [
  ['red', red, paper],
  ['paper', paper, red],
  ['ink', ink, paper],
]) {
  add(
    `background-${name}`,
    `Background · ${name} geometry`,
    'Text-free 16:9 artwork with open space on the left. Use behind your own social layouts or presentations.',
    'backgrounds',
    1920,
    1080,
    background,
    ring(1490, 575, 690, foreground, 0.18, 2) +
      ring(1490, 575, 455, foreground, 0.14, 2) +
      mark(1220, 275, 635, foreground, name === 'paper' ? 0.84 : 0.75) +
      rule(96, 940, 1824, 940, foreground, 0.18, 1) +
      `<circle cx="99" cy="99" r="4" fill="${foreground}" opacity="0.5"/>`
  );
}

await fs.mkdir(path.join(output, 'previews'), { recursive: true });
for (const category of new Set(compositions.map(({ asset }) => asset.category))) {
  await fs.mkdir(path.join(output, category), { recursive: true });
}
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const { source, asset } of compositions) {
    await fs.writeFile(path.join(root, 'public', asset.svg), source);
    await page.setViewportSize({ width: asset.width, height: asset.height });
    await page.setContent(
      `<style>html,body{margin:0;width:100%;height:100%;background:transparent}svg{display:block;width:100vw;height:100vh}</style>${source}`
    );
    await page.screenshot({ path: path.join(root, 'public', asset.png), omitBackground: true });
    const ratio = Math.min(600 / asset.width, 600 / asset.height, 1);
    await page.setViewportSize({
      width: Math.round(asset.width * ratio),
      height: Math.round(asset.height * ratio),
    });
    await page.screenshot({ path: path.join(root, 'public', asset.preview), omitBackground: true });
    process.stdout.write(`Rendered ${asset.id} (${asset.width} × ${asset.height})\n`);
  }
  const contactTiles = await Promise.all(
    compositions.map(
      async ({ asset }) =>
        `<div class="tile"><div class="image" style="background:${asset.background}"><img src="data:image/png;base64,${(await fs.readFile(path.join(root, 'public', asset.preview))).toString('base64')}" /></div><div class="caption">${escape(asset.title)}<small>${asset.width} × ${asset.height}</small></div></div>`
    )
  );
  await page.setViewportSize({ width: 1440, height: 2100 });
  await page.setContent(
    `<style>*{box-sizing:border-box}body{margin:0;padding:38px;background:${paper};color:${ink};font:14px Arial,sans-serif}h1{font-size:38px;letter-spacing:-1px;margin:0 0 8px}p{color:${muted};margin:0 0 28px}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:20px}.tile{border:1px solid ${line};background:white}.image{height:207px;padding:8px;display:flex;align-items:center;justify-content:center}.image img{max-width:100%;max-height:100%}.caption{font-weight:600;padding:12px}.caption small{display:block;font-weight:400;font-size:11px;color:${muted};margin-top:6px}</style><h1>Allowance. The red edition.</h1><p>26 original assets · PNG + outlined SVG · Profiles, wallpapers, headers, posts and backgrounds</p><div class="grid">${contactTiles.join('')}</div>`
  );
  await page.screenshot({ path: path.join(output, 'brand-overview.png'), fullPage: true });
} finally {
  await browser.close();
}

await fs.writeFile(
  path.join(root, 'public/allowance-wordmark.svg'),
  compositions.find(({ asset }) => asset.id === 'wordmark-red')!.source
);
for (const file of ['Figtree-LICENSE.txt', 'GeistMono-LICENSE.txt']) {
  await fs.copyFile(path.join(root, 'public/fonts', file), path.join(output, 'fonts', file));
}
await fs.writeFile(
  path.join(output, 'README.md'),
  `# Allowance brand kit — red edition

26 original compositions, each in PNG and outlined SVG. All symbols derive from the canonical two-path Allowance mark. SVG lettering is outlined, so it stays consistent without installing fonts. Transparent logo PNGs preserve alpha; put the white versions on a dark background.

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

Brand red ${red}; paper ${paper}; ink ${ink}; muted ${muted}; line ${line}; soft red ${soft}.
Figtree 600 for the wordmark and headlines; Figtree 400 for supporting copy; Geist Mono 500 for labels.

Keep the logo's proportions and leave clear space around it. Use the supplied contrasting versions. The social designs describe Allowance's public rehearsal; no real payment, verified settlement or Solana endorsement is claimed.

## Font source and licenses

The included original font files are distributed under their accompanying SIL Open Font Licenses. They were obtained from the official Google Fonts repository:
- https://github.com/google/fonts/tree/main/ofl/figtree
- https://github.com/google/fonts/tree/main/ofl/geistmono

The application uses WOFF2 versions of these families. The generator uses the original variable TTF files because fontkit 2.0.4 cannot apply variations reliably to WOFF2 fonts. No network access is needed to regenerate the kit.

Run **npm run brand:generate** in the source repository after installing dependencies and Playwright Chromium. The generator reads the canonical SVG, outlines the locally licensed fonts, exports PNGs with Chromium, writes the manifest and packages this ZIP. Generated composition source is in **scripts/generate-brand-kit.ts**.
`
);
const manifest = {
  version: '2026-09-13',
  name: 'Allowance — Red edition',
  palette: [
    { name: 'Brand red', hex: red },
    { name: 'Paper', hex: paper },
    { name: 'Ink', hex: ink },
    { name: 'Muted', hex: muted },
    { name: 'Line', hex: line },
    { name: 'Soft red', hex: soft },
  ],
  zip: '/brand/allowance-brand-kit.zip',
  assets: compositions.map(({ asset }) => asset),
};
await fs.writeFile(path.join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
const zipEntries = [
  'README.md',
  'manifest.json',
  'brand-overview.png',
  'fonts',
  ...new Set(compositions.map(({ asset }) => asset.category)),
];
const temporaryZip = path.join(output, 'allowance-brand-kit-next.zip');
await fs.rm(temporaryZip, { force: true });
await runFile('zip', ['-q', '-r', temporaryZip, ...zipEntries], { cwd: output });
await fs.rename(temporaryZip, path.join(output, 'allowance-brand-kit.zip'));
process.stdout.write(
  `Brand kit complete: ${compositions.length} assets, ${(await fs.stat(path.join(output, 'allowance-brand-kit.zip'))).size} ZIP bytes.\n`
);
