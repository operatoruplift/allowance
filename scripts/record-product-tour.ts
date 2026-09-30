import { chromium, expect, type Locator, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const defaults = {
  overview: 11.2,
  policy: 9.5,
  cap: 4.8,
  permissions: 3,
  workspace: 4.3,
  save: 4.7,
  setup: 8.6,
  closing: 6.94,
};
type Scene = keyof typeof defaults;
const help = `Record real public Allowance interactions without signing or API access.

  npx tsx scripts/record-product-tour.ts --url http://127.0.0.1:4328 --out test-results/product-tour
    [--timing scene-seconds.json] [--headed]

Timing JSON contains seconds for every scene: ${JSON.stringify(defaults)}.
The output directory must be empty. Use the static public build, not a private operator server.
`;
const options = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) {
  const flag = process.argv[i];
  if (flag === '--help') {
    process.stdout.write(help);
    process.exit(0);
  }
  if (flag === '--headed') options.set(flag, 'true');
  else if (['--url', '--out', '--timing'].includes(flag) && process.argv[i + 1])
    options.set(flag, process.argv[++i]);
  else throw new Error(`Unknown or incomplete option: ${flag}\n${help}`);
}
if (!options.has('--url') || !options.has('--out')) throw new Error(help);
const base = new URL(options.get('--url')!);
if (
  !['http:', 'https:'].includes(base.protocol) ||
  base.username ||
  base.password ||
  base.search ||
  base.hash ||
  base.pathname !== '/'
)
  throw new Error('Use an HTTP(S) origin without credentials, path, query, or fragment.');
const supplied: unknown = options.has('--timing')
  ? JSON.parse(await fs.readFile(options.get('--timing')!, 'utf8'))
  : defaults;
if (!supplied || typeof supplied !== 'object' || Array.isArray(supplied))
  throw new Error('Timing must be an object containing seconds for all eight scenes.');
const timing = supplied as Record<string, unknown>;
if (
  Object.keys(timing).length !== Object.keys(defaults).length ||
  Object.keys(defaults).some(
    (key) =>
      typeof timing[key] !== 'number' ||
      !Number.isFinite(timing[key]) ||
      (timing[key] as number) < 0.25 ||
      (timing[key] as number) > 90
  )
)
  throw new Error('Each named scene needs a finite duration from 0.25 to 90 seconds.');
const durations = timing as typeof defaults;
const output = path.resolve(options.get('--out')!);
await fs.mkdir(output, { recursive: true });
if ((await fs.readdir(output)).length) throw new Error('Capture output directory must be empty.');

const browser = await chromium.launch({ headless: !options.has('--headed') });
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
  recordVideo: { dir: output, size: { width: 1920, height: 1080 } },
  serviceWorkers: 'block',
  acceptDownloads: true,
  locale: 'en-US',
  colorScheme: 'light',
});
const blocked: { method: string; pathname: string; reason: string }[] = [];
const errors: string[] = [];
await context.route('**/*', async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  if (url.protocol === 'blob:' || url.protocol === 'data:') return route.continue();
  const reason =
    url.origin !== base.origin
      ? 'external origin'
      : request.method() !== 'GET' && request.method() !== 'HEAD'
        ? 'mutation'
        : /^\/(api|merchant|tools)(\/|$)/.test(url.pathname)
          ? 'backend endpoint'
          : ['fetch', 'xhr', 'websocket'].includes(request.resourceType())
            ? 'runtime service call'
            : undefined;
  if (!reason) return route.continue();
  blocked.push({ method: request.method(), pathname: url.pathname, reason });
  await route.abort('blockedbyclient');
});
await context.routeWebSocket('**/*', (socket) => {
  blocked.push({ method: 'WS', pathname: new URL(socket.url()).pathname, reason: 'websocket' });
  socket.close();
});
// This presentation overlay identifies the recording and makes real mouse movement visible.
// It does not alter application data, controls, receipts, or payment statuses.
await context.addInitScript(() => {
  window.addEventListener('DOMContentLoaded', () => {
    const label = document.createElement('div');
    label.textContent = 'Workspace tour · No funds moved';
    label.setAttribute('aria-hidden', 'true');
    label.style.cssText =
      'position:fixed;left:24px;bottom:22px;z-index:2147483647;pointer-events:none;padding:10px 15px;border:1px solid #ded8d2;border-radius:99px;background:#fffdf8;color:#252225;font:600 15px/1.4 system-ui;box-shadow:0 3px 15px #00000010';
    const cursor = document.createElement('div');
    cursor.setAttribute('aria-hidden', 'true');
    cursor.style.cssText =
      'position:fixed;left:0;top:0;width:20px;height:20px;border:2px solid #c92031;border-radius:50%;background:#c9203120;z-index:2147483646;pointer-events:none;transform:translate(-40px,-40px);box-shadow:0 0 0 3px #ffffffaa;transition:width .12s,height .12s';
    document.body.append(label, cursor);
    document.addEventListener('mousemove', (event) => {
      cursor.style.transform = `translate(${event.clientX - 10}px,${event.clientY - 10}px)`;
    });
    document.addEventListener('mousedown', () => {
      cursor.style.background = '#c9203188';
    });
    document.addEventListener('mouseup', () => {
      cursor.style.background = '#c9203120';
    });
  });
});
const page = await context.newPage();
page.setDefaultTimeout(10_000);
page.on('pageerror', (error) => errors.push(error.message));
const video = page.video()!;
const scenes: { id: Scene; startSeconds: number; durationSeconds: number }[] = [];

async function point(target: Locator) {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error('Tour control is not visible.');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 10 });
  await page.waitForTimeout(180);
}
async function click(target: Locator) {
  await point(target);
  await target.click();
}
async function top() {
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  await page.waitForTimeout(700);
}
async function loaded(page: Page) {
  await page.locator('main').waitFor();
  await page.evaluate(() => document.fonts.ready);
}
async function scene(id: Scene, action: () => Promise<void>) {
  const before = performance.now();
  const startSeconds = scenes.reduce((sum, item) => sum + item.durationSeconds, 0);
  await action();
  const elapsed = performance.now() - before;
  const remaining = durations[id] * 1000 - elapsed;
  if (remaining < 0)
    throw new Error(`${id} needs ${(elapsed / 1000).toFixed(1)}s; increase its timing.`);
  await page.waitForTimeout(remaining);
  scenes.push({ id, startSeconds, durationSeconds: durations[id] });
}

try {
  await page.goto(new URL('/app?view=overview', base).href, { waitUntil: 'networkidle' });
  await loaded(page);
  await expect(page.getByRole('heading', { name: 'Your agent’s workspace.' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Workspace navigation' })).toBeVisible();
  await expect(page.getByText('Mainnet setup required.', { exact: true })).toBeVisible();
  const started = performance.now();
  await scene('overview', async () => {
    await point(
      page
        .getByRole('navigation', { name: 'Workspace navigation' })
        .getByRole('link', { name: 'Overview', exact: true })
    );
  });
  await scene('policy', async () => {
    await click(
      page
        .getByRole('navigation', { name: 'Explore Allowance' })
        .getByRole('link', { name: 'Policy lab', exact: true })
    );
    await expect(page.getByRole('heading', { name: 'Set the boundary' })).toBeVisible();
    await expect(page.getByText('No funds moved.', { exact: true })).toBeVisible();
    await expect(page.getByTestId('planned-cost')).toHaveText('0.030000');
    await point(page.getByLabel('Total allowance', { exact: false }));
  });
  await scene('cap', async () => {
    const cap = page.getByLabel('Per-request cap', { exact: false });
    await click(cap);
    await cap.fill('0.010000');
    await cap.press('Tab');
    await expect(page.getByTestId('planned-cost')).toHaveText('0.010000');
    await expect(page.locator('.lab-request.blocked')).toHaveCount(2);
    await point(page.getByTestId('planned-cost'));
  });
  await scene('permissions', async () => {
    await click(page.getByRole('button', { name: 'Reset limits and requests' }));
    await click(page.getByRole('checkbox', { name: /Transaction explanation/ }));
    await expect(page.getByTestId('planned-cost')).toHaveText('0.010000');
    await expect(page.getByRole('checkbox', { name: /Transaction explanation/ })).not.toBeChecked();
  });
  await scene('workspace', async () => {
    const nav = page.getByRole('navigation', { name: 'Workspace navigation' });
    for (const name of ['Runs', 'Payments', 'Setup']) {
      const link = nav.getByRole('link', { name, exact: true });
      await click(link);
      await expect(link).toHaveAttribute('aria-current', 'page');
    }
  });
  await scene('save', async () => {
    await click(
      page
        .getByRole('navigation', { name: 'Explore Allowance' })
        .getByRole('link', { name: 'Policy lab', exact: true })
    );
    await expect(page.getByTestId('planned-cost')).toHaveText('0.030000');
    const downloadPromise = page.waitForEvent('download');
    await click(page.getByRole('button', { name: 'Save policy plan' }));
    const download = await downloadPromise;
    await download.saveAs(path.join(output, 'policy-plan.json'));
    const plan = JSON.parse(await fs.readFile(path.join(output, 'policy-plan.json'), 'utf8'));
    if (plan.kind !== 'policy-plan' || plan.paymentSubmitted !== false || 'signature' in plan)
      throw new Error('Downloaded plan did not preserve its non-payment boundary.');
    await top();
  });
  await scene('setup', async () => {
    await click(
      page
        .getByRole('navigation', { name: 'Workspace navigation' })
        .getByRole('link', { name: 'Setup', exact: true })
    );
    await expect(page.getByRole('heading', { name: 'What remains to connect' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Mainnet setup required.' })).toBeVisible();
  });
  await scene('closing', async () => {
    await click(
      page
        .getByRole('navigation', { name: 'Workspace navigation' })
        .getByRole('link', { name: 'Overview', exact: true })
    );
    await expect(page.getByRole('heading', { name: 'Your agent’s workspace.' })).toBeVisible();
    await point(
      page
        .getByRole('navigation', { name: 'Workspace navigation' })
        .getByRole('link', { name: 'Setup', exact: true })
    );
  });
  const contentSeconds = (performance.now() - started) / 1000;
  if (blocked.length || errors.length)
    throw new Error(
      `Capture encountered ${blocked.length} forbidden requests and ${errors.length} browser errors.`
    );
  await context.close();
  const videoPath = await video.path();
  const rawDuration = Number(
    execFileSync(
      'ffprobe',
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        videoPath,
      ],
      { encoding: 'utf8' }
    ).trim()
  );
  if (!Number.isFinite(rawDuration) || rawDuration < contentSeconds - 0.2)
    throw new Error('Recorded video is shorter than the completed tour.');
  await fs.writeFile(
    path.join(output, 'capture.json'),
    JSON.stringify(
      {
        version: 1,
        recordedAt: new Date().toISOString(),
        origin: base.origin,
        video: path.basename(videoPath),
        width: 1920,
        height: 1080,
        rawDurationSeconds: rawDuration,
        contentDurationSeconds: contentSeconds,
        // Playwright begins recording during initial page load. Trim only that lead-in.
        trimStartSeconds: Math.max(0, rawDuration - contentSeconds),
        scenes,
        paymentSubmitted: false,
        blockedRequests: blocked,
        browserErrors: errors,
      },
      null,
      2
    ) + '\n'
  );
  process.stdout.write(`Captured public product tour: ${path.join(output, 'capture.json')}\n`);
} catch (error) {
  await fs.writeFile(
    path.join(output, 'capture-failed.json'),
    JSON.stringify(
      {
        message: error instanceof Error ? error.message : String(error),
        scenes,
        blockedRequests: blocked,
        browserErrors: errors,
      },
      null,
      2
    ) + '\n'
  );
  throw error;
} finally {
  await context.close();
  await browser.close();
}
