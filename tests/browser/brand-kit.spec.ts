import { expect, test } from '@playwright/test';
import fs from 'node:fs/promises';
import manifest from '../../public/brand/manifest.json' with { type: 'json' };

const filters = {
  logos: 'Logos',
  profiles: 'Profile pictures',
  wallpapers: 'Wallpapers',
  headers: 'Headers',
  social: 'Social & ads',
  backgrounds: 'Backgrounds',
} as const;

test('brand library filters assets, previews accessibly, and downloads the original PNG and kit', async ({
  page,
  baseURL,
}) => {
  const serviceRequests: string[] = [];
  const origin = new URL(baseURL!).origin;
  page.on('request', (request) => {
    if (
      new URL(request.url()).origin !== origin ||
      new URL(request.url()).pathname.startsWith('/api/') ||
      ['fetch', 'xhr'].includes(request.resourceType())
    ) {
      serviceRequests.push(request.url());
    }
  });

  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto('/brand');
  await expect(page.getByRole('heading', { name: 'A little more possibility.' })).toBeVisible();
  await expect(page.locator('.bk-asset-card')).toHaveCount(manifest.assets.length);
  await page.screenshot({
    path: 'evidence/brand-kit-2026-09-23-desktop.png',
    animations: 'disabled',
  });

  const collections =
    (manifest as typeof manifest & { collections?: { id: string; title: string }[] }).collections ??
    [];
  expect(collections).toHaveLength(3);
  await page
    .getByRole('link', { name: `Explore ${collections[0].title} collection`, exact: true })
    .click();
  const collectionAssets = manifest.assets.filter(
    (asset) => (asset as typeof asset & { collection?: string }).collection === collections[0].id
  );
  await expect(page.locator('.bk-asset-card')).toHaveCount(collectionAssets.length);
  await expect(
    page.getByRole('heading', { name: collections[0].title, exact: true, level: 2 })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Show all collections' }).click();
  await expect(page.locator('.bk-asset-card')).toHaveCount(manifest.assets.length);

  for (const [category, label] of Object.entries(filters)) {
    const filter = page.getByRole('button', { name: new RegExp(`^${label}`) });
    await filter.click();
    await expect(filter).toHaveAttribute('aria-pressed', 'true');
    const assets = manifest.assets.filter((asset) => asset.category === category);
    expect(assets.length).toBeGreaterThan(0);
    await expect(page.locator('.bk-asset-card')).toHaveCount(assets.length);
    await expect(page.locator('.bk-asset-card').first()).toHaveAttribute('data-category', category);
  }

  await page.getByRole('button', { name: /^Profile pictures/ }).click();
  const asset = manifest.assets.find((item) => item.category === 'profiles')!;
  const preview = page.getByRole('button', { name: `Preview ${asset.title}`, exact: true });
  await preview.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: asset.title })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Close asset preview' })).toBeFocused();
  await expect(dialog.getByRole('link', { name: /Open full-size image/ })).toHaveAttribute(
    'href',
    `${asset.png}?v=${encodeURIComponent(manifest.version)}`
  );
  await expect(dialog.getByRole('link', { name: /Open full-size image/ })).toHaveAttribute(
    'target',
    '_blank'
  );

  const downloadEvent = page.waitForEvent('download');
  await dialog.getByRole('link', { name: /^Download PNG/ }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe(asset.png.split('/').pop());
  const png = await fs.readFile((await download.path())!);
  expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  expect(png.readUInt32BE(16)).toBe(asset.width);
  expect(png.readUInt32BE(20)).toBe(asset.height);

  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(preview).toBeFocused();

  const zipEvent = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download the full kit' }).click();
  const archive = await zipEvent;
  expect(archive.suggestedFilename()).toBe(manifest.zip.split('/').pop());
  const zip = await fs.readFile((await archive.path())!);
  expect(zip.subarray(0, 4).toString('hex')).toBe('504b0304');
  expect(zip.length).toBeGreaterThan(1000);
  expect(serviceRequests).toEqual([]);
});

test('brand kit and full-size save flow fit narrow phones without clipping', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/brand');
    await expect(page.getByRole('heading', { name: 'Saving to your phone?' })).toBeVisible();
    await page.screenshot({
      path: `evidence/brand-kit-2026-09-23-mobile-${width}.png`,
      animations: 'disabled',
    });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true);
    await page.getByRole('button', { name: /^Wallpapers/ }).click();
    const portrait = page.locator('.bk-asset-card[data-format="tall"] .bk-preview-button').first();
    const portraitBounds = await portrait.boundingBox();
    expect(portraitBounds!.height).toBeGreaterThan(portraitBounds!.width * 1.6);
    await page.screenshot({
      path: `evidence/brand-kit-2026-09-23-wallpapers-${width}.png`,
      animations: 'disabled',
    });
    await page
      .getByRole('button', { name: /^Preview / })
      .first()
      .click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const bounds = await dialog.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true
    );
    const popupEvent = page.waitForEvent('popup');
    await dialog.getByRole('link', { name: /Open full-size image/ }).click();
    const popup = await popupEvent;
    await popup.waitForLoadState('load');
    await expect(popup.locator('img')).toBeVisible();
    expect(
      await popup.locator('img').evaluate((element: HTMLImageElement) => element.naturalWidth)
    ).toBeGreaterThan(0);
    await popup.close();
    await dialog.getByRole('button', { name: 'Close asset preview' }).click();
    await expect(dialog).not.toBeVisible();
  }
});
