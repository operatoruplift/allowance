import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
test('landing, keyboard CTA, private route and developer guide', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Give your agent a budget.' })).toBeVisible();
  await page.screenshot({
    path: 'evidence/release-2026-09-20-landing-desktop.png',
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
  // Print works immediately from Activity, before opening Receipt or any purchase.
  await page.evaluate(() => {
    window.print = () => {
      document.body.dataset.printCalled = 'true';
    };
  });
  await page.getByRole('button', { name: 'Print receipt' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-print-called', 'true');
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.receipt-card')).toBeVisible();
  await expect(page.getByText('None — no transaction submitted', { exact: true })).toHaveCount(3);
  await expect(page.locator('.purchase-expanded').first()).toBeVisible();
  await page.emulateMedia({ media: 'screen' });
  await page.getByRole('button', { name: /^Receipt/ }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export JSON' }).click();
  const download = await downloadPromise;
  const file = await download.path();
  const receipt = JSON.parse(await fs.readFile(file!, 'utf8'));
  expect(receipt).toMatchObject({
    mode: 'rehearsal',
    paymentNetwork: 'mainnet',
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
    path: 'evidence/release-2026-09-20-rehearsal-desktop-complete.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.emulateMedia({ media: 'print' });
  await page.pdf({
    path: 'evidence/release-2026-09-20-rehearsal-print.pdf',
    format: 'A4',
    printBackground: true,
  });
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
  await page.getByLabel('Choose an example').selectOption('empty');
  await page.getByRole('button', { name: 'Run the rehearsal', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your wallet activity brief' })).toBeVisible({
    timeout: 15000,
  });
  await expect(page.getByText(/represents a wallet with no SOL balance/)).toBeVisible();
  await page.getByLabel('Choose an example').selectOption('failure');
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
    path: 'evidence/release-2026-09-20-rehearsal-mobile-complete.png',
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

test('deterministic recovery keeps an ambiguous hold until the original intent is reconciled', async ({
  page,
}) => {
  await page.goto('/demo');
  await page.getByLabel('Choose an example').selectOption('ambiguous');
  await page.getByRole('button', { name: 'Run the rehearsal', exact: true }).click();
  await expect(page.getByText(/settlement evidence is unknown/)).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('button', { name: 'Review offline hold' })).toBeVisible();
  await page.getByRole('button', { name: 'Review offline hold' }).click();
  await expect(page.getByRole('heading', { name: 'Your wallet activity brief' })).toBeVisible();
  await expect(page.getByText('Original hold reconciled')).toBeVisible();
  await expect(page.locator('.progress-finished')).toContainText('Run interrupted');
  await expect(page.locator('.progress-finished')).not.toContainText(
    'Task finished within its allowance.'
  );
  await expect(page.locator('.report-card .amber-pill')).toHaveText('Recovery report');
  await expect(page.locator('.receipt-card')).toContainText('Settled · result unavailable');
  await expect(page.locator('.receipt-card')).toContainText('Held');
  await expect(page.locator('.receipt-card')).toContainText('0.000000');
  await expect(page.locator('.report-card')).toContainText('no RPC, signing, or paid request');
  await expect(page.locator('.purchase-entry')).toHaveCount(1);
  await expect(page.locator('.purchase-status-icon.amber-text')).toHaveCount(1);
});

test('stopping an example releases its unsigned hold and rerunning begins with a clean receipt', async ({
  page,
}) => {
  await page.clock.install();
  await page.goto('/demo');
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  await page.getByRole('button', { name: 'Run the rehearsal', exact: true }).click();
  await page.clock.runFor(100);
  await expect(page.getByText('Task received', { exact: true })).toBeVisible();
  await page.clock.runFor(700);
  await expect(page.getByText('Wallet snapshot reserved', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Stop run', exact: true }).click();
  await page.clock.runFor(5000);
  await expect(page.getByText('Rehearsal stopped', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^Receipt/ }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export JSON' }).click();
  const download = await downloadPromise;
  const receipt = JSON.parse(await fs.readFile((await download.path())!, 'utf8'));
  expect(receipt).toMatchObject({ status: 'stopped', settled: '0', held: '0', remaining: '40000' });
  expect(receipt.purchases).toHaveLength(1);
  expect(receipt.purchases[0]).toMatchObject({ status: 'released', chainVerified: false });
  await page.getByRole('button', { name: 'Run rehearsal again', exact: true }).click();
  await page.clock.resume();
  await expect(page.getByRole('heading', { name: 'Your wallet activity brief' })).toBeVisible();
  await expect(page.locator('.purchase-entry')).toHaveCount(2);
  await expect(page.getByText('Rehearsal stopped', { exact: true })).toHaveCount(0);
  await expect(page.locator('a[href*="explorer.solana.com"]')).toHaveCount(0);
});
