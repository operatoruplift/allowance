import { expect, test } from '@playwright/test';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { evidencePath } from './evidence';

test('the supplied launch film waits for play and downloads the original web delivery', async ({
  page,
}) => {
  const filmRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/media/allowance-launch-film.mp4')
      filmRequests.push(request.url());
  });
  await page.goto('/');
  const film = page.getByRole('region', { name: 'A little independence. A clear limit.' });
  const video = page.getByLabel('Allowance launch film', { exact: true });
  await page.getByRole('link', { name: 'Watch launch film', exact: true }).click();
  await expect(page).toHaveURL(/#launch-film$/);
  await expect(film).toBeInViewport();
  await expect(video).toHaveAttribute('preload', 'none');
  await expect(video).toHaveJSProperty('paused', true);
  expect(filmRequests).toEqual([]);
  await expect(film).toContainText('Planning scenes. No funds moved.');
  await film.screenshot({ path: evidencePath('launch-film-desktop-poster.png') });
  await page.getByRole('button', { name: 'Play launch film', exact: true }).click();
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
    .toBeGreaterThan(0.1);
  const metadata = await video.evaluate((element: HTMLVideoElement) => ({
    width: element.videoWidth,
    height: element.videoHeight,
    duration: element.duration,
    controls: element.controls,
    autoplay: element.autoplay,
    playsInline: element.playsInline,
    muted: element.muted,
  }));
  expect(metadata).toMatchObject({
    width: 1920,
    height: 1080,
    controls: true,
    autoplay: false,
    playsInline: true,
    muted: false,
  });
  expect(metadata.duration).toBeCloseTo(30, 1);
  await expect(page.getByRole('button', { name: 'Play launch film', exact: true })).toHaveCount(0);
  await video.evaluate((element: HTMLVideoElement) => element.pause());
  const downloaded = page.waitForEvent('download');
  await film.getByRole('link', { name: 'Save film', exact: true }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe('allowance-launch-film.mp4');
  expect(await download.failure()).toBeNull();
  const bytes = await fs.readFile((await download.path())!);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(
    'ed934c2d40235a40abfe2135d532081ce73d1a0173b0c74bd16217d83ac9ef64'
  );
  await film.screenshot({ path: evidencePath('launch-film-desktop.png') });
});

test('a failed launch film keeps the visual story and actual app walkthrough reachable on a phone', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/media/allowance-launch-film.mp4', (route) => route.abort('failed'));
  await page.goto('/#launch-film');
  const film = page.getByRole('region', { name: 'A little independence. A clear limit.' });
  await film.screenshot({ path: evidencePath('launch-film-phone-poster.png') });
  await film.getByRole('button', { name: 'Play launch film', exact: true }).click();
  await expect(film.getByRole('status')).toContainText('The launch film could not load.');
  await film.getByText('Read the visual story', { exact: true }).click();
  await expect(
    film.getByText('This description follows the on-screen scenes in the supplied launch film.')
  ).toBeVisible();
  await expect(film.getByRole('list')).toContainText('Blocked before signing.');
  await expect(film.getByRole('list')).toContainText('No funds moved.');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );
  await film.screenshot({ path: evidencePath('launch-film-phone-fallback.png') });
  await film.getByRole('link', { name: 'Open the app walkthrough', exact: true }).click();
  await expect(page).toHaveURL(/\/demo#product-tour$/);
  await expect(
    page.getByRole('region', { name: 'A budget. A boundary. A clear record.' })
  ).toBeVisible();
});
