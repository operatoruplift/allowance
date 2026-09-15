import { expect, test } from '@playwright/test';

test('selected source films advance, pause accessibly, and honor reduced motion', async ({ page }) => {
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

  const pause = page.getByRole('button', { name: 'Pause Axiom cloud film' });
  await pause.click();
  await expect(page.getByRole('button', { name: 'Play Axiom cloud film' })).toBeVisible();
  expect(await cloud.evaluate((video: HTMLVideoElement) => video.paused)).toBe(true);
  await page.getByRole('button', { name: 'Play Axiom cloud film' }).click();
  await expect(page.getByRole('button', { name: 'Pause Axiom cloud film' })).toBeVisible();

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect
    .poll(() => cloud.evaluate((video: HTMLVideoElement) => video.paused), { timeout: 5000 })
    .toBe(true);
  await page.locator('[data-film="Constellation mountain film"]').scrollIntoViewIfNeeded();
  await expect
    .poll(() => mountains.evaluate((video: HTMLVideoElement) => video.currentTime), {
      timeout: 15000,
    })
    .toBeGreaterThan(0.1);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Axiom cloud film paused for reduced motion' })).toBeDisabled();
  expect(await page.locator('[data-film="Axiom cloud film"] video').evaluate((video: HTMLVideoElement) => video.paused)).toBe(true);

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.reload();
  const visibleCloud = page.locator('[data-film="Axiom cloud film"] video');
  await expect
    .poll(() => visibleCloud.evaluate((video: HTMLVideoElement) => video.paused), { timeout: 15000 })
    .toBe(false);
  await page.evaluate(() => Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }));
  await page.dispatchEvent('body', 'visibilitychange');
  await expect
    .poll(() => visibleCloud.evaluate((video: HTMLVideoElement) => video.paused), { timeout: 5000 })
    .toBe(true);

  expect(externalRequests).toEqual([]);
});
