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
const symbolPaths = [...symbol.matchAll(/<path[^>]*\sd="([^"]+)"[^>]*>/g)].map((match) => match[1]);
if (symbolPaths.length !== 2 || !symbol.includes('viewBox="0 0 256 256"')) {
  throw new Error('Expected the canonical two-part A symbol in a 256 × 256 viewBox.');
}

function font(file: string, weight: number) {
  const loaded = openSync(path.join(output, 'fonts', file));
  if (!('layout' in loaded)) throw new Error('A single font file is required.');
  return loaded.getVariation({ wght: weight });
}
const display = font('Figtree-Variable.ttf', 600);
const strong = font('Figtree-Variable.ttf', 650);
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
  return `<g opacity="${opacity}" fill="${color}" transform="translate(${x} ${y}) scale(${size / 256})">${symbolPaths.map((d) => `<path d="${d}"/>`).join('')}</g>`;
}
function lockup(x: number, y: number, width: number, color: string) {
  return `<g transform="translate(${x} ${y}) scale(${width / 1024})">${mark(0, 0, 224, color)}${text('Allowance.', 280, 166, 147, color)}</g>`;
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

type Collection = 'sculpture' | 'open-sky' | 'paper-study';
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
  collection?: Collection;
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
  previewBackground = background ?? paper,
  collection?: Collection
) {
  const source = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img"><title>${escape(title)} — Allowance</title><desc>${escape(description)} ${category === 'logos' ? 'Original Allowance artwork.' : 'Allowance composition with the canonical vector A and, where present, an AI-generated art plate.'} Typography outlined from OFL-licensed Figtree and Geist Mono.</desc>${background ? `<rect width="${width}" height="${height}" fill="${background}"/>` : ''}${artwork}</svg>`;
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
      ...(collection ? { collection } : {}),
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
    'Transparent background. The two-part curved A mark, ready for your own layouts.',
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

// Original generated art is embedded, so each exported SVG remains self-contained.
// Logos and type stay exact vector geometry; the artwork is a raster photograph-style plate.
const plates = Object.fromEntries(
  await Promise.all(
    ['sculpture', 'sculpture-wide', 'sky', 'paper'].map(async (name) => [
      name,
      `data:image/jpeg;base64,${(await fs.readFile(path.join(output, 'art', `${name}.jpg`))).toString('base64')}`,
    ])
  )
) as Record<'sculpture' | 'sculpture-wide' | 'sky' | 'paper', string>;
function plate(
  name: keyof typeof plates,
  x: number,
  y: number,
  width: number,
  height: number,
  alignment = 'xMidYMid slice'
) {
  return `<svg x="${x}" y="${y}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" overflow="hidden"><image href="${plates[name]}" width="${width}" height="${height}" preserveAspectRatio="${alignment}"/></svg>`;
}
function block(x: number, y: number, width: number, height: number, color: string, opacity = 1) {
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${color}" opacity="${opacity}"/>`;
}
function headline(
  values: string[],
  x: number,
  y: number,
  size: number,
  color: string,
  leading = 0.97
) {
  return lines(values, x, y, size, color, leading, strong);
}
function edition(x: number, y: number, color: string, name: string, size = 14) {
  return label(`ALLOWANCE / ${name}`, x, y, color, size);
}
function rehearsal(x: number, y: number, color: string, size = 13) {
  return label('TRY THE EXAMPLE · NO REAL PAYMENTS', x, y, color, size);
}

for (const [name, foreground, collection] of [
  ['red', paper, 'sculpture'],
  ['paper', red, 'paper-study'],
  ['ink', paper, 'sculpture'],
] as const) {
  const backdrop = name === 'red' ? red : name === 'paper' ? paper : ink;
  const material =
    name === 'red'
      ? plate('sculpture', 0, 0, 1024, 1024, 'xMidYMin slice') +
        block(0, 0, 1024, 1024, '#40050D', 0.23)
      : name === 'paper'
        ? plate('paper', 0, 0, 1024, 1024, 'xMidYMin slice') + block(0, 0, 1024, 1024, paper, 0.47)
        : `<defs><radialGradient id="profile-light" cx="28%" cy="15%" r="95%"><stop stop-color="#544044"/><stop offset="1" stop-color="#160F11"/></radialGradient></defs>${block(0, 0, 1024, 1024, 'url(#profile-light)')}`;
  add(
    `profile-${name}`,
    `Profile picture · ${name}`,
    'The canonical A on a softly lit material surface. Centered with room for circular profile crops.',
    'profiles',
    1024,
    1024,
    backdrop,
    material + mark(197, 197, 630, foreground),
    backdrop,
    collection
  );
}

add(
  'header-x-red',
  'X header · open possibilities',
  'Sculptural red architecture in an open sky. The lower-left avatar overlap stays free of essential text.',
  'headers',
  1500,
  500,
  paper,
  plate('sky', 925, 0, 575, 500, 'xMaxYMid slice') +
    lockup(421, 55, 240, red) +
    headline(['A little', 'independence.'], 416, 228, 68, ink, 1.03) +
    text('A clear limit.', 421, 389, 33, red, regular),
  paper,
  'open-sky'
);
add(
  'header-linkedin-paper',
  'LinkedIn header · quiet confidence',
  'Ivory paper, warm light, and one clear idea. The left side is quiet for the profile-photo overlap.',
  'headers',
  1584,
  396,
  paper,
  plate('paper', 0, 0, 1584, 396, 'xMidYMid slice') +
    block(410, 0, 1174, 396, paper, 0.6) +
    lockup(472, 64, 288, red) +
    text('Room to do useful things.', 474, 244, 64, ink, strong) +
    label('AGENT AUTONOMY. WITH AN ALLOWANCE.', 477, 302, red, 13),
  paper,
  'paper-study'
);
add(
  'header-youtube-ink',
  'YouTube banner · a wider world',
  'An architectural landscape. Essential logo and message remain inside the central 1546 × 423 safe area.',
  'headers',
  2560,
  1440,
  paper,
  plate('sky', 0, 0, 2560, 1440) +
    lockup(592, 556, 433, ink) +
    headline(['A little independence.', 'A clear limit.'], 595, 764, 83, ink, 1.03),
  paper,
  'open-sky'
);

add(
  'wallpaper-phone-red',
  'Phone wallpaper · red sculpture',
  'A tactile red study in light and shadow. Quiet space above leaves room for the lock-screen clock.',
  'wallpapers',
  1080,
  1920,
  red,
  plate('sculpture', 0, 0, 1080, 1920, 'xMidYMax slice') +
    mark(75, 1540, 112, paper) +
    edition(78, 1733, paper, 'FORM 01', 14),
  red,
  'sculpture'
);
add(
  'wallpaper-phone-paper',
  'Phone wallpaper · open sky',
  'Red architecture under a luminous sky. Minimal branding and a calm upper canvas for the clock.',
  'wallpapers',
  1080,
  1920,
  paper,
  plate('sky', 0, 0, 1080, 1920, 'xMaxYMid slice') +
    mark(76, 1505, 118, ink) +
    edition(79, 1728, ink, 'OPEN SKY', 14),
  paper,
  'open-sky'
);
add(
  'wallpaper-phone-ink',
  'Phone wallpaper · paper after dark',
  'A gallery-like paper study against deep ink. Deliberately quiet at the top, with no advertising headline.',
  'wallpapers',
  1080,
  1920,
  ink,
  plate('paper', 72, 597, 936, 1138, 'xMidYMax slice') +
    mark(91, 475, 69, paper) +
    edition(88, 1792, paper, 'PAPER STUDY', 13),
  ink,
  'paper-study'
);
add(
  'wallpaper-desktop-red',
  'Desktop wallpaper · red sculpture',
  'A 4K canvas with a sculptural artwork at right and continuous deep-red space for desktop icons at left.',
  'wallpapers',
  3840,
  2160,
  ink,
  plate('sculpture-wide', 0, 0, 3840, 2160) +
    mark(140, 1644, 170, paper) +
    edition(145, 1920, paper, 'RED SCULPTURE / 01', 22),
  ink,
  'sculpture'
);
add(
  'wallpaper-desktop-paper',
  'Desktop wallpaper · open sky',
  'A 4K architectural landscape with expansive sky, warm light and a small, precise signature.',
  'wallpapers',
  3840,
  2160,
  paper,
  plate('sky', 0, 0, 3840, 2160) +
    mark(145, 1730, 157, ink) +
    edition(150, 1980, ink, 'OPEN SKY / 02', 23),
  paper,
  'open-sky'
);

add(
  'social-square-budget',
  'Square post · useful freedom',
  'Bold editorial type meets tactile red sculpture. A short message designed to read clearly in a feed.',
  'social',
  1080,
  1080,
  red,
  plate('sculpture', 0, 0, 1080, 1080, 'xMidYMax slice') +
    lockup(65, 48, 283, paper) +
    headline(['Useful', 'freedom.'], 62, 307, 156, paper) +
    text('Give your agent a budget.', 71, 647, 31, paper, regular) +
    rehearsal(71, 1008, paper, 12),
  red,
  'sculpture'
);
add(
  'social-square-policy',
  'Square post · you set the limit',
  'An open, airy campaign composition. The human sets the boundary; the agent gets room to act.',
  'social',
  1080,
  1080,
  paper,
  plate('sky', 0, 445, 1080, 635) +
    lockup(68, 48, 272, ink) +
    headline(['You set the limit.'], 62, 275, 105, ink) +
    text('Your agent takes it from there.', 73, 352, 31, red, regular) +
    block(0, 990, 1080, 90, ink) +
    rehearsal(72, 1040, paper, 12),
  paper,
  'open-sky'
);
add(
  'social-square-receipt',
  'Square post · nothing lost',
  'Oversized typography on a tactile paper study. The message is about records, without invented transaction stats.',
  'social',
  1080,
  1080,
  paper,
  plate('paper', 0, 0, 1080, 1080, 'xMidYMin slice') +
    lockup(65, 51, 273, red) +
    headline(['Small budget.', 'Full picture.'], 61, 321, 113, ink, 1.03) +
    text('Every decision leaves a record.', 69, 561, 32, red, regular) +
    rehearsal(72, 1008, ink, 12),
  paper,
  'paper-study'
);
add(
  'social-portrait-budget',
  'Portrait post · room to act',
  'A spacious 4:5 campaign image with emphatic typography and red architecture beneath an open sky.',
  'social',
  1080,
  1350,
  paper,
  plate('sky', 0, 683, 1080, 667) +
    lockup(68, 50, 281, red) +
    headline(['Room to act.'], 50, 341, 170, ink) +
    text('Give your agent a budget.', 66, 439, 36, red, regular) +
    rehearsal(68, 576, ink, 12),
  paper,
  'open-sky'
);
add(
  'social-portrait-policy',
  'Portrait post · your call',
  'An expressive paper-and-ink poster about human control. A red editorial column anchors the composition.',
  'social',
  1080,
  1350,
  red,
  plate('paper', 408, 0, 672, 1350, 'xMaxYMid slice') +
    lockup(64, 49, 283, paper) +
    block(46, 214, 930, 193, red) +
    text('The model asks.', 65, 351, 113, paper, strong) +
    block(46, 496, 800, 554, red) +
    headline(['Your', 'call.'], 56, 764, 239, paper, 0.94) +
    text('A little independence.', 65, 1124, 27, paper, regular) +
    text('A clear limit.', 65, 1164, 27, paper, regular) +
    block(0, 1241, 1080, 109, red) +
    rehearsal(65, 1300, paper, 12),
  red,
  'paper-study'
);
add(
  'social-story-budget',
  'Story · a little independence',
  'A vertical red campaign composition. Essential copy stays clear of the usual story controls at top and bottom.',
  'social',
  1080,
  1920,
  red,
  plate('sculpture', 0, 0, 1080, 1920, 'xMidYMax slice') +
    lockup(74, 288, 322, paper) +
    headline(['Give it', 'room.'], 63, 628, 206, paper) +
    text('Give your agent an allowance.', 77, 1021, 34, paper, regular) +
    rehearsal(79, 1588, paper, 13) +
    label('ALLOWANCEONSOLANA.VERCEL.APP', 79, 1630, paper, 12),
  red,
  'sculpture'
);

add(
  'background-red',
  'Background · red sculpture',
  'Text-free artwork with a continuous deep-red field at left for your own typography or presentation content.',
  'backgrounds',
  1920,
  1080,
  ink,
  plate('sculpture-wide', 0, 0, 1920, 1080),
  ink,
  'sculpture'
);
add(
  'background-paper',
  'Background · open sky',
  'Text-free architectural scenery with clear space at left. Ready for your own layouts and presentations.',
  'backgrounds',
  1920,
  1080,
  paper,
  plate('sky', 0, 0, 1920, 1080),
  paper,
  'open-sky'
);
add(
  'background-ink',
  'Background · paper study',
  'Text-free paper sculpture and soft shadows. Warm, quiet material for your own social designs.',
  'backgrounds',
  1920,
  1080,
  paper,
  plate('paper', 0, 0, 1920, 1080, 'xMidYMax slice'),
  paper,
  'paper-study'
);

await fs.mkdir(path.join(output, 'previews'), { recursive: true });
for (const category of new Set(compositions.map(({ asset }) => asset.category))) {
  await fs.mkdir(path.join(output, category), { recursive: true });
}
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const favicon = await fs.readFile(path.join(root, 'public/favicon-red.svg'), 'utf8');
  for (const [filename, size] of [
    ['favicon-32.png', 32],
    ['apple-touch-icon.png', 180],
    ['allowance-icon-192.png', 192],
    ['allowance-icon-512.png', 512],
  ] as const) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<style>body{margin:0}body>svg{display:block;width:100vw;height:100vh}</style>${favicon}`
    );
    await page.screenshot({ path: path.join(root, 'public', filename), omitBackground: true });
  }
  const shareImage = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630"><rect width="1200" height="630" fill="${paper}"/>${plate('sky', 735, 0, 465, 630, 'xMaxYMid slice')}${lockup(52, 38, 260, red)}${headline(['Give your agent', 'a budget.'], 47, 263, 85, ink, 1.02)}${text('Useful freedom. Clear limits.', 54, 481, 30, red, regular)}${rehearsal(54, 569, ink, 11)}</svg>`;
  await page.setViewportSize({ width: 1200, height: 630 });
  await page.setContent(
    `<style>body{margin:0}body>svg{display:block;width:100vw;height:100vh}</style>${shareImage}`
  );
  await page.evaluate(async () => {
    await Promise.all(
      [...document.querySelectorAll('svg image')].map((element) => {
        const image = new Image();
        image.src = element.getAttribute('href') ?? '';
        return image.decode();
      })
    );
  });
  await page.screenshot({ path: path.join(root, 'public/allowance-share.png') });
  for (const { source, asset } of compositions) {
    await fs.writeFile(path.join(root, 'public', asset.svg), source);
    await page.setViewportSize({ width: asset.width, height: asset.height });
    await page.setContent(
      `<style>html,body{margin:0;width:100%;height:100%;background:transparent}body>svg{display:block;width:100vw;height:100vh}</style>${source}`
    );
    await page.evaluate(async () => {
      await Promise.all(
        [...document.querySelectorAll('svg image')].map((element) => {
          const image = new Image();
          image.src = element.getAttribute('href') ?? '';
          return image.decode();
        })
      );
    });
    await page.screenshot({ path: path.join(root, 'public', asset.png), omitBackground: true });
    const ratio = Math.min(600 / asset.width, 600 / asset.height, 1);
    await page.setViewportSize({
      width: Math.round(asset.width * ratio),
      height: Math.round(asset.height * ratio),
    });
    await page.screenshot({ path: path.join(root, 'public', asset.preview), omitBackground: true });
    process.stdout.write(`Rendered ${asset.id} (${asset.width} × ${asset.height})\n`);
  }
  const artOrder = [
    'wallpaper-desktop-red',
    'wallpaper-phone-paper',
    'social-square-receipt',
    'social-square-budget',
    'social-square-policy',
    'social-portrait-budget',
    'social-portrait-policy',
    'social-story-budget',
    'wallpaper-phone-red',
    'wallpaper-phone-ink',
    'wallpaper-desktop-paper',
    'header-x-red',
    'header-linkedin-paper',
    'header-youtube-ink',
    'background-red',
    'background-paper',
    'background-ink',
  ];
  const ordered = [
    ...artOrder.map((id) => compositions.find(({ asset }) => asset.id === id)!),
    ...compositions.filter(
      ({ asset }) => asset.category === 'profiles' || asset.category === 'logos'
    ),
  ];
  const contactTiles = await Promise.all(
    ordered.map(
      async ({ asset }) =>
        `<div class="tile ${asset.category === 'logos' || asset.category === 'profiles' ? 'identity' : 'art'}"><div class="image" style="background:${asset.background}"><img alt="${escape(asset.title)}" src="data:image/png;base64,${(await fs.readFile(path.join(root, 'public', asset.preview))).toString('base64')}" /></div><div class="caption">${escape(asset.title)}<small>${asset.width} × ${asset.height} · ${asset.category}</small></div></div>`
    )
  );
  await page.setViewportSize({ width: 1440, height: 2100 });
  await page.setContent(
    `<style>*{box-sizing:border-box}body{margin:0;padding:60px;background:${paper};color:${ink};font:14px Arial,sans-serif}h1{font-size:64px;letter-spacing:-3px;line-height:1;margin:18px 0 28px}p{color:${muted};margin:0 0 48px;line-height:1.5;max-width:820px}.kicker{font:12px monospace;letter-spacing:3px;color:${red}}.grid{display:grid;grid-template-columns:repeat(6,1fr);gap:32px 22px}.tile.art{grid-column:span 2}.tile.identity{grid-column:span 1}.image{height:340px;display:flex;align-items:center;justify-content:center;overflow:hidden}.image img{max-width:100%;max-height:100%}.identity .image{height:143px;padding:15px}.caption{font-weight:600;padding:12px 0;line-height:1.4}.caption small{display:block;font-weight:400;font-size:11px;color:${muted};margin-top:4px}.footer{border-top:1px solid ${line};margin-top:45px;padding-top:20px;font:12px monospace}</style><div class="kicker">ALLOWANCE / THE MATERIAL EDITION / 2026</div><h1>A little independence.<br>A more expressive identity.</h1><p>Red sculpture. Open sky. Paper study. A collection of 26 finished artworks and identity essentials.<br>PNG for sharing. Self-contained SVG with exact vector lettering and embedded art.</p><div class="grid">${contactTiles.join('')}</div><div class="footer">CANONICAL A / ORIGINAL AI-GENERATED ART PLATES / FIGTREE + GEIST MONO</div>`
  );
  await page.evaluate(async () => {
    await Promise.all([...document.images].map((item) => item.decode()));
  });
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
  `# Allowance brand kit — material edition

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

Brand red ${red}; paper ${paper}; ink ${ink}; muted ${muted}; line ${line}; soft red ${soft}.
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

`.trimEnd() + '\n'
);
const manifest = {
  version: '2026-09-23',
  name: 'Allowance — Material edition',
  collections: [
    {
      id: 'sculpture',
      title: 'Red sculpture',
      description: 'Tactile red forms. A little independence.',
      coverId: 'wallpaper-desktop-red',
    },
    {
      id: 'open-sky',
      title: 'Open sky',
      description: 'Open space. Clear boundaries.',
      coverId: 'wallpaper-phone-paper',
    },
    {
      id: 'paper-study',
      title: 'Paper study',
      description: 'Quiet material. Strong ideas.',
      coverId: 'social-square-receipt',
    },
  ],
  featured: [
    'wallpaper-desktop-red',
    'wallpaper-phone-paper',
    'social-square-receipt',
    'header-x-red',
    'social-portrait-budget',
    'wallpaper-phone-ink',
  ],
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
const manifestJSON = `${JSON.stringify(manifest, null, 2)}\n`;
await fs.writeFile(path.join(output, 'manifest.json'), manifestJSON);
// Bundle catalog data locally; importing from Vite's public directory is unsupported.
await fs.writeFile(path.join(root, 'src/brand-manifest.json'), manifestJSON);
const zipEntries = [
  'README.md',
  'manifest.json',
  'brand-overview.png',
  'fonts',
  'art',
  ...compositions.flatMap(({ asset }) => [
    asset.png.replace('/brand/', ''),
    asset.svg.replace('/brand/', ''),
  ]),
];
const temporaryZip = path.join(output, 'allowance-brand-kit-next.zip');
await fs.rm(temporaryZip, { force: true });
await runFile('zip', ['-q', '-r', temporaryZip, ...zipEntries], { cwd: output });
await fs.rename(temporaryZip, path.join(output, 'allowance-brand-kit.zip'));
process.stdout.write(
  `Brand kit complete: ${compositions.length} assets, ${(await fs.stat(path.join(output, 'allowance-brand-kit.zip'))).size} ZIP bytes.\n`
);
