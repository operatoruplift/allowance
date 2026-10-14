// Regenerates the Solana dApp Store listing kit in docs/dapp-store: the banner,
// composed from brand assets in banner.html, and portrait screenshots captured
// from the live public site. Every file is checked against the store's sizes
// before the script reports success.
//
//   npm run store:kit                     banner and screenshots
//   npm run store:kit -- --banner         banner only
//   npm run store:kit -- --screenshots    screenshots only
//
// STORE_KIT_URL points the screenshots at another deployment of the public site.

import { mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, devices, type Browser, type Locator, type Page } from '@playwright/test';

const root = fileURLToPath(new URL('../', import.meta.url));
const kit = path.join(root, 'docs/dapp-store');
const screenshotDir = path.join(kit, 'screenshots');
const siteUrl = (process.env.STORE_KIT_URL ?? 'https://allowanceonsolana.vercel.app').replace(
  /\/$/,
  ''
);

const BANNER = { width: 1200, height: 600 } as const;
// 360 × 640 CSS pixels at deviceScaleFactor 3: the store's 1080 × 1920 portrait.
const PHONE = { width: 360, height: 640, scale: 3 } as const;
const SCREENSHOT = { width: PHONE.width * PHONE.scale, height: PHONE.height * PHONE.scale };
const MAX_SCREENSHOT_BYTES = 3 * 1024 * 1024;
// A reserved name that can never resolve, so the banner page reaches nothing but
// the repository files served to it below.
const ASSET_ORIGIN = 'https://store-kit.invalid';
const STEP_TIMEOUT = 30_000;

interface Shot {
  file: string;
  route: string;
  /** Freeze the page's timers so a run can be photographed mid-step. */
  pausedClock?: boolean;
  prepare(page: Page): Promise<void>;
}

const heading = (page: Page, name: string | RegExp) =>
  page.getByRole('heading', { name }).first().waitFor({ timeout: STEP_TIMEOUT });

const shots: Shot[] = [
  {
    file: '01-landing.png',
    route: '/',
    prepare: (page) => heading(page, 'Give your agent a budget.'),
  },
  {
    file: '02-policy-lab.png',
    route: '/lab',
    async prepare(page) {
      await heading(page, /Find the right/);
      const allowance = page.getByLabel('Total allowance');
      await allowance.fill('0.010000');
      await allowance.blur();
      await page
        .getByTestId('plan-remaining')
        .filter({ hasText: '0.000000' })
        .waitFor({ timeout: STEP_TIMEOUT });
      // Frame what the edit did: the planned-cost card, then the plan below it
      // with two requests now blocked.
      await scrollToTop(page, page.getByTestId('planned-cost'), 76);
    },
  },
  {
    file: '03-walkthrough-running.png',
    route: '/demo',
    pausedClock: true,
    async prepare(page) {
      await heading(page, 'A little budget. Useful work.');
      // Stop the page's clock, then step the run by hand: the task is received
      // after 80 ms and the first purchase is reserved 650 ms after that.
      await page.clock.pauseAt(Date.now() + 60_000);
      await page.getByRole('button', { name: 'Run walkthrough', exact: true }).click();
      await advanceRun(page, 80, 1);
      await advanceRun(page, 650, 2);
      // The budget meter, now holding the reservation, above the running steps.
      await scrollToTop(page, page.getByRole('heading', { name: 'Run progress' }), 360);
    },
  },
  {
    file: '04-walkthrough-receipt.png',
    route: '/demo',
    async prepare(page) {
      await heading(page, 'A little budget. Useful work.');
      await page.getByRole('button', { name: 'Run walkthrough', exact: true }).click();
      await heading(page, 'Your wallet activity brief');
      await page.getByRole('button', { name: 'Test the boundary' }).click();
      await heading(page, 'The limit held. No third payment.');
      const receipt = page.getByRole('button', { name: /^Receipt/ });
      await receipt.click();
      await scrollToTop(page, receipt, 16);
    },
  },
  {
    file: '05-developers.png',
    route: '/developers',
    prepare: (page) => heading(page, 'Small pieces. Explicit boundaries.'),
  },
  {
    file: '06-console.png',
    route: '/app?view=overview',
    prepare: (page) => heading(page, 'Your agent’s workspace.'),
  },
];

/**
 * Move a paused walkthrough on by one step and wait until its activity shows it.
 * The next step's timer is set from an effect after each render, so the short
 * real-time pause lets React register it before the clock moves again.
 */
async function advanceRun(page: Page, milliseconds: number, events: number) {
  await page.clock.runFor(milliseconds);
  await page
    .getByRole('button', { name: new RegExp(`^Activity\\s*${events}$`) })
    .waitFor({ timeout: STEP_TIMEOUT });
  await page.waitForTimeout(250);
}

/** Scroll so the element sits `offset` CSS pixels below the top of the viewport. */
async function scrollToTop(page: Page, target: Locator, offset: number) {
  await target.first().evaluate((element, gap) => {
    const top = element.getBoundingClientRect().top + window.scrollY - gap;
    window.scrollTo({ top: Math.max(0, top), behavior: 'instant' });
  }, offset);
}

/** Fail rather than photograph fallback type: both brand faces must be in use. */
async function assertBrandFonts(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  const loaded = await page.evaluate(() =>
    [...document.fonts]
      .filter((face) => face.status === 'loaded')
      .map((face) => face.family.replace(/["']/g, ''))
  );
  for (const family of ['Figtree', 'Geist Mono'])
    if (!loaded.includes(family)) throw new Error(`${family} did not load on ${page.url()}`);
}

async function renderBanner(browser: Browser): Promise<string> {
  const context = await browser.newContext({ viewport: BANNER, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== ASSET_ORIGIN) return route.abort();
    const file = path.join(root, decodeURIComponent(url.pathname));
    if (!file.startsWith(root)) return route.abort();
    await route.fulfill({ path: file });
  });
  await page.goto(`${ASSET_ORIGIN}/docs/dapp-store/banner.html`, { waitUntil: 'load' });
  await assertBrandFonts(page);
  const file = path.join(kit, 'banner-1200x600.png');
  await page.screenshot({ path: file, animations: 'disabled' });
  await context.close();
  return file;
}

async function captureScreenshots(browser: Browser): Promise<string[]> {
  await mkdir(screenshotDir, { recursive: true });
  for (const stale of await readdir(screenshotDir))
    if (stale.endsWith('.png')) await rm(path.join(screenshotDir, stale));
  const files: string[] = [];
  for (const shot of shots) {
    const context = await browser.newContext({
      ...devices['Pixel 7'],
      viewport: { width: PHONE.width, height: PHONE.height },
      screen: { width: PHONE.width, height: PHONE.height },
      deviceScaleFactor: PHONE.scale,
      isMobile: true,
      hasTouch: true,
      serviceWorkers: 'block',
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    if (shot.pausedClock) await page.clock.install();
    await page.goto(`${siteUrl}${shot.route}`, { waitUntil: 'load' });
    await shot.prepare(page);
    await assertBrandFonts(page);
    const file = path.join(screenshotDir, shot.file);
    await page.screenshot({ path: file, animations: 'disabled' });
    files.push(file);
    process.stdout.write(`captured ${shot.file} from ${siteUrl}${shot.route}\n`);
    await context.close();
  }
  return files;
}

/** Width and height from a PNG's IHDR chunk, which always follows the signature. */
async function pngSize(file: string): Promise<{ width: number; height: number }> {
  const header = (await readFile(file)).subarray(0, 24);
  if (header.subarray(1, 4).toString('latin1') !== 'PNG') throw new Error(`${file} is not a PNG`);
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
}

async function verify(
  file: string,
  expected: { width: number; height: number },
  maxBytes = Infinity
): Promise<string[]> {
  const { width, height } = await pngSize(file);
  const { size } = await stat(file);
  const name = path.relative(kit, file);
  process.stdout.write(`${name}  ${width} × ${height}  ${(size / 1024).toFixed(0)} KB\n`);
  const problems: string[] = [];
  if (width !== expected.width || height !== expected.height)
    problems.push(`${name} is ${width} × ${height}, not ${expected.width} × ${expected.height}`);
  if (size >= maxBytes) problems.push(`${name} is ${size} bytes, over the ${maxBytes} limit`);
  return problems;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const both = !args.has('--banner') && !args.has('--screenshots');
  const browser = await chromium.launch();
  const problems: string[] = [];
  try {
    if (both || args.has('--banner'))
      problems.push(...(await verify(await renderBanner(browser), BANNER)));
    if (both || args.has('--screenshots')) {
      const files = await captureScreenshots(browser);
      for (const file of files)
        problems.push(...(await verify(file, SCREENSHOT, MAX_SCREENSHOT_BYTES)));
      if (files.length < 4 || files.length > 8)
        problems.push(`${files.length} screenshots; the store takes 4 to 8`);
    }
  } finally {
    await browser.close();
  }
  if (problems.length) throw new Error(problems.join('\n'));
  process.stdout.write('Listing kit verified.\n');
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
