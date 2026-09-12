import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
test('landing, keyboard CTA, private route and developer guide', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Give your agent a budget.' })).toBeVisible();
  await page.screenshot({
    path: 'evidence/landing-desktop.png',
    fullPage: true,
    animations: 'disabled',
  });
  const cta = page.getByRole('link', { name: /Try the example/i }).first();
  await cta.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/demo/);
  await page.goto('/app');
  await expect(page).toHaveURL(/\/login/);
  await expect(
    page.getByText('Operator access needs setup.').or(page.getByLabel('Operator password'))
  ).toBeVisible();
  await page.goto('/developers');
  await expect(page.getByRole('heading', { name: /Small pieces/ })).toBeVisible();
});
test('full fixture, separate probe and JSON export have exact accounting and no live APIs', async ({
  page,
  baseURL,
}) => {
  const liveRequests: string[] = [];
  const allowedOrigin = new URL(baseURL!).origin;
  page.on('request', (req) => {
    if (
      new URL(req.url()).origin !== allowedOrigin ||
      req.url().includes('/api/') ||
      ['fetch', 'xhr'].includes(req.resourceType())
    )
      liveRequests.push(req.url());
  });
  await page.goto('/demo');
  await page.getByRole('button', { name: 'Run the rehearsal', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your wallet activity brief' })).toBeVisible({
    timeout: 15000,
  });
  await expect(page.getByRole('heading', { name: 'What if it asks for one more?' })).toBeVisible();
  await page.getByRole('button', { name: 'Test the boundary' }).click();
  await expect(
    page.getByRole('heading', { name: 'The limit held. No third payment.' })
  ).toBeVisible();
  await page.getByRole('button', { name: /^Receipt/ }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export JSON' }).click();
  const download = await downloadPromise;
  const file = await download.path();
  const receipt = JSON.parse(await fs.readFile(file!, 'utf8'));
  expect(receipt).toMatchObject({
    mode: 'rehearsal',
    settled: '30000',
    held: '0',
    remaining: '10000',
  });
  expect(receipt.purchases).toHaveLength(3);
  expect(receipt.purchases[2]).toMatchObject({ source: 'policy-probe', status: 'denied' });
  expect(receipt.purchases.every((p: { signature?: string }) => !p.signature)).toBe(true);
  expect(liveRequests).toEqual([]);
  await expect(page.locator('a[href*="explorer.solana.com"]')).toHaveCount(0);
  await page.getByRole('heading', { name: 'A little budget. Useful work.' }).click();
  await page.screenshot({
    path: 'evidence/rehearsal-desktop-complete.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.emulateMedia({ media: 'print' });
  await page.pdf({ path: 'evidence/rehearsal-print.pdf', format: 'A4', printBackground: true });
});
test('mobile and reduced-motion layout, empty history, service failure and reset are honest', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/demo');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );
  await page.getByLabel('Explore an outcome').selectOption('empty');
  await page.getByRole('button', { name: 'Run the rehearsal', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your wallet activity brief' })).toBeVisible({
    timeout: 15000,
  });
  await expect(page.getByText(/represents a wallet with no SOL balance/)).toBeVisible();
  await page.getByLabel('Explore an outcome').selectOption('failure');
  await page.getByRole('button', { name: 'Run the rehearsal', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Fixture service failure', {
    timeout: 15000,
  });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Run the rehearsal', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Run the rehearsal', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your wallet activity brief' })).toBeVisible({
    timeout: 15000,
  });
  await page.getByRole('button', { name: 'Test the boundary' }).click();
  await page.getByRole('heading', { name: 'A little budget. Useful work.' }).click();
  await page.screenshot({
    path: 'evidence/rehearsal-mobile-complete.png',
    fullPage: true,
    animations: 'disabled',
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );
  await page.setViewportSize({ width: 640, height: 450 });
  await page.evaluate(() => {
    document.documentElement.style.zoom = '2';
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );
});
