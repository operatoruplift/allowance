import { expect, test } from '@playwright/test';

test('local films autoplay in view, suspend offscreen, and keep their original posters', async ({
  page,
  baseURL,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const externalRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).origin !== new URL(baseURL!).origin)
      externalRequests.push(request.url());
  });
  await page.goto('/');
  const cloud = page.locator('[data-film="Axiom cloud film"] video');
  const mountains = page.locator('[data-film="Constellation mountain film"] video');
  await expect(cloud).toHaveAttribute('src', '/media/allowance-cloud.mp4');
  await expect(mountains).toHaveAttribute('src', '/media/allowance-mountains.mp4');
  await expect
    .poll(() => cloud.evaluate((video: HTMLVideoElement) => video.currentTime))
    .toBeGreaterThan(0.1);
  expect(await cloud.evaluate((video: HTMLVideoElement) => video.autoplay)).toBe(true);
  expect(await cloud.evaluate((video: HTMLVideoElement) => video.paused)).toBe(false);
  await expect(page.locator('.film-control')).toHaveCount(0);

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect.poll(() => cloud.evaluate((video: HTMLVideoElement) => video.paused)).toBe(true);
  await page.locator('[data-film="Constellation mountain film"]').scrollIntoViewIfNeeded();
  await expect
    .poll(() => mountains.evaluate((video: HTMLVideoElement) => video.currentTime))
    .toBeGreaterThan(0.1);
  await expect
    .poll(() => mountains.evaluate((video: HTMLVideoElement) => video.paused))
    .toBe(false);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => mountains.evaluate((video: HTMLVideoElement) => video.paused)).toBe(true);
  expect(externalRequests).toEqual([]);
});

test('device and saved motion preferences show posters without stopping example state updates', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const films: string[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('.mp4')) films.push(request.url());
  });
  await page.goto('/');
  await expect(page.locator('[data-film="Axiom cloud film"]')).toHaveAttribute(
    'data-film-state',
    'poster'
  );
  await expect(page.locator('[data-film="Axiom cloud film"] video')).not.toHaveAttribute('src');
  await expect(
    page.locator('[data-film="Axiom cloud film"] .decorative-film-poster')
  ).toBeVisible();
  expect(films).toEqual([]);

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.getByRole('button', { name: 'Reduce motion', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Motion reduced', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
  await page.goto('/demo');
  await page.getByRole('button', { name: 'Run the rehearsal', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your wallet activity brief' })).toBeVisible();
  await expect(page.locator('.budget-meter')).toContainText('0.030000');
  await expect(page.locator('.budget-meter')).toContainText('0.010000');
});

test('media failures and data saving keep the readable interface and supplied posters', async ({
  page,
}) => {
  await page.route('**/*.mp4', (route) => route.abort());
  await page.goto('/');
  const cloud = page.locator('[data-film="Axiom cloud film"]');
  await expect(cloud).toHaveAttribute('data-film-state', 'unavailable');
  await expect(cloud.locator('.decorative-film-poster')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Give your agent a budget.' })).toBeVisible();
  await page.screenshot({ path: 'evidence/release-2026-09-20-media-failure.png', fullPage: true });
  await page.getByRole('link', { name: 'Try the example', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Run the rehearsal', exact: true })).toBeVisible();

  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'connection', {
      configurable: true,
      value: Object.assign(new EventTarget(), { saveData: true }),
    })
  );
  await page.goto('/');
  await expect(cloud).toHaveAttribute('data-film-state', 'poster');
  await expect(cloud.locator('video')).not.toHaveAttribute('src');
});
