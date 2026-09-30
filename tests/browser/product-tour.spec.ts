import { expect, test } from '@playwright/test';
import fs from 'node:fs/promises';
import { evidencePath } from './evidence';

test('the product tour loads real video and native captions, and chapters seek and play', async ({
  page,
}) => {
  await page.goto('/demo#product-tour');
  const video = page.getByLabel('Allowance product tour', { exact: true });
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState))
    .toBeGreaterThanOrEqual(1);
  const metadata = await video.evaluate((element: HTMLVideoElement) => ({
    duration: element.duration,
    width: element.videoWidth,
    height: element.videoHeight,
    paused: element.paused,
    controls: element.controls,
    autoplay: element.autoplay,
    currentTime: element.currentTime,
  }));
  expect(metadata.duration).toBeCloseTo(53.04, 0);
  expect(metadata).toMatchObject({
    width: 1920,
    height: 1080,
    paused: true,
    controls: true,
    autoplay: false,
    currentTime: 0,
  });
  const captions = video.locator('track[kind="captions"]');
  await expect(captions).toHaveAttribute('srclang', 'en');
  await expect
    .poll(() => captions.evaluate((element: HTMLTrackElement) => element.readyState))
    .toBe(2);
  const track = await captions.evaluate((element: HTMLTrackElement) => {
    const cues = Array.from(element.track.cues ?? []);
    return {
      count: cues.length,
      first: cues[0]?.startTime,
      last: cues[cues.length - 1]?.endTime,
      text: cues.map((cue) => (cue as VTTCue).text).join(' '),
    };
  });
  expect(track.count).toBeGreaterThan(5);
  expect(track.first).toBeGreaterThanOrEqual(0);
  expect(track.last).toBeLessThanOrEqual(metadata.duration + 0.25);
  expect(track.text.length).toBeGreaterThan(300);

  const chapters = page.getByRole('navigation', { name: 'Product tour chapters' });
  await expect(chapters.getByRole('button')).toHaveCount(5);
  const third = chapters.getByRole('button', { name: 'Play chapter 3: Make the limits yours' });
  await expect(third).toBeEnabled();
  await third.click();
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.paused))
    .toBe(false);
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
    .toBeGreaterThanOrEqual(20.7);
  await expect(third).toHaveAttribute('aria-current', 'step');
  // A second user chapter action must also work after playback has begun.
  const first = chapters.getByRole('button', { name: 'Play chapter 1: Give work a boundary' });
  await first.click();
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
    .toBeLessThan(11.2);
  await expect(first).toHaveAttribute('aria-current', 'step');
  await expect(
    page.getByText('Product walkthrough · No funds moved', { exact: true })
  ).toBeVisible();
  await video.evaluate((element: HTMLVideoElement) => element.pause());
  await page.screenshot({ path: evidencePath('product-tour-desktop.png'), fullPage: true });
});

test('tour video, transcript and captions download as usable files on a narrow phone', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/demo#product-tour');
  const tour = page.getByRole('region', { name: 'A budget. A boundary. A clear record.' });
  await expect(tour).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );
  for (const [label, filename] of [
    ['Save video', 'allowance-product-tour.mp4'],
    ['Read transcript', 'allowance-product-tour.txt'],
    ['Download captions', 'allowance-product-tour.vtt'],
  ]) {
    const downloaded = page.waitForEvent('download');
    await tour.getByRole('link', { name: label, exact: true }).click();
    const download = await downloaded;
    expect(download.suggestedFilename()).toBe(filename);
    expect(await download.failure()).toBeNull();
    const path = await download.path();
    expect(path).not.toBeNull();
    const bytes = await fs.readFile(path!);
    if (filename.endsWith('.mp4')) {
      expect(bytes.length).toBeGreaterThan(100_000);
      expect(bytes.subarray(4, 8).toString('ascii')).toBe('ftyp');
    } else {
      const text = bytes.toString('utf8');
      expect(text.length).toBeGreaterThan(300);
      expect(text).not.toMatch(/<!doctype html/i);
      if (filename.endsWith('.vtt')) {
        expect(text).toMatch(/^WEBVTT/);
        expect(text).toContain('-->');
      }
    }
  }
  await page.screenshot({ path: evidencePath('product-tour-phone.png'), fullPage: true });
});

test('failed tour media leaves an accessible transcript, planning link and interactive controls', async ({
  page,
}) => {
  await page.route('**/media/allowance-product-tour.mp4', (route) => route.abort('failed'));
  await page.goto('/demo#product-tour');
  const tour = page.getByRole('region', { name: 'A budget. A boundary. A clear record.' });
  await expect(tour.getByRole('status')).toContainText(
    'The video could not load. You can still read the transcript or open the policy lab.'
  );
  const chapters = tour.getByRole('navigation', { name: 'Product tour chapters' });
  for (const button of await chapters.getByRole('button').all())
    await expect(button).toBeDisabled();
  await expect(tour.getByRole('link', { name: 'Read transcript', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Run walkthrough', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your wallet activity brief' })).toBeVisible();
  await chapters.getByRole('link', { name: 'Try the controls', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Find the right/ })).toBeVisible();
});
