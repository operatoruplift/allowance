import { expect, test } from '@playwright/test';

test('selected source films autoplay continuously without manual pause controls', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const externalRequests: string[] = [];
  const origin = 'http://127.0.0.1:4318';
  page.on('request', (request) => {
    if (new URL(request.url()).origin !== origin) externalRequests.push(request.url());
  });
  await page.goto('/');

  const cloud = page.locator('[data-film="Axiom cloud film"] video');
  const mountains = page.locator('[data-film="Constellation mountain film"] video');
  await expect(cloud).toHaveAttribute('src', '/media/allowance-cloud.mp4');
  await expect(mountains).toHaveAttribute('src', '/media/allowance-mountains.mp4');
  await expect
    .poll(() => cloud.evaluate((video: HTMLVideoElement) => video.readyState), {
      timeout: 15000,
    })
    .toBeGreaterThanOrEqual(2);
  await expect
    .poll(() => cloud.evaluate((video: HTMLVideoElement) => video.currentTime), {
      timeout: 15000,
    })
    .toBeGreaterThan(0.1);

  await expect(page.locator('.film-control')).toHaveCount(0);
  expect(await cloud.evaluate((video: HTMLVideoElement) => video.autoplay)).toBe(true);
  expect(await cloud.evaluate((video: HTMLVideoElement) => video.paused)).toBe(false);

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect
    .poll(() => cloud.evaluate((video: HTMLVideoElement) => video.paused), { timeout: 5000 })
    .toBe(false);
  await page.locator('[data-film="Constellation mountain film"]').scrollIntoViewIfNeeded();
  await expect
    .poll(() => mountains.evaluate((video: HTMLVideoElement) => video.currentTime), {
      timeout: 15000,
    })
    .toBeGreaterThan(0.1);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  await expect(page.locator('.film-control')).toHaveCount(0);
  const reducedCloud = page.locator('[data-film="Axiom cloud film"] video');
  expect(await reducedCloud.evaluate((video: HTMLVideoElement) => video.autoplay)).toBe(true);
  await expect
    .poll(() => reducedCloud.evaluate((video: HTMLVideoElement) => video.currentTime), { timeout: 15000 })
    .toBeGreaterThan(0.1);
  expect(await reducedCloud.evaluate((video: HTMLVideoElement) => video.paused)).toBe(false);

  expect(externalRequests).toEqual([]);
});
