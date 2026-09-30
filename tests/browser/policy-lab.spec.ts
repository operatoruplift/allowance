import { expect, test } from '@playwright/test';
import fs from 'node:fs/promises';
import { evidencePath } from './evidence';

test('policy lab calculates exact limits, rejects invalid inputs, and exports a plan', async ({
  page,
}) => {
  const requests: string[] = [];
  page.on('request', (request) => {
    if (['fetch', 'xhr'].includes(request.resourceType())) requests.push(request.url());
  });
  await page.goto('/lab');
  await expect(page.getByTestId('planned-cost')).toHaveText('0.030000');
  await expect(page.getByTestId('plan-remaining')).toHaveText('0.010000');
  await expect(page.getByTestId('plan-daily-remaining')).toHaveText('0.070000');
  await expect(page.locator('.lab-request.blocked')).toHaveCount(1);

  await page.getByLabel('Per-request cap', { exact: false }).fill('0.019999');
  await expect(page.getByTestId('planned-cost')).toHaveText('0.010000');
  await expect(page.locator('.lab-request.blocked')).toHaveCount(2);
  await page.getByLabel('Per-request cap', { exact: false }).fill('0.020000');
  await page.getByLabel('Total allowance', { exact: false }).fill('0.050000');
  await expect(page.getByTestId('planned-cost')).toHaveText('0.050000');
  await page.getByLabel('Daily capacity', { exact: false }).fill('0.029999');
  await expect(page.getByTestId('planned-cost')).toHaveText('0.010000');
  await expect(page.getByTestId('plan-daily-remaining')).toHaveText('0.019999');

  await page.getByLabel('Total allowance', { exact: false }).fill('abc');
  await expect(page.getByLabel('Total allowance', { exact: false })).toHaveAttribute(
    'aria-invalid',
    'true'
  );
  await expect(page.locator('#plan-allowance-error')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save policy plan' })).toBeDisabled();
  await expect(page.getByTestId('planned-cost')).toHaveText('—');
  await page.getByRole('button', { name: 'Reset limits and requests' }).click();
  await expect(page.getByTestId('planned-cost')).toHaveText('0.030000');
  await expect(page.locator('#plan-allowance-error')).toHaveCount(0);
  await page.getByRole('checkbox', { name: /Transaction explanation/ }).uncheck();
  await expect(page.getByTestId('planned-cost')).toHaveText('0.010000');
  await page.getByRole('checkbox', { name: /Transaction explanation/ }).check();

  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save policy plan' }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe('allowance-policy-plan.json');
  const plan = JSON.parse(await fs.readFile((await download.path())!, 'utf8'));
  expect(plan).toMatchObject({
    kind: 'policy-plan',
    network: 'mainnet',
    paymentSubmitted: false,
    plannedCost: '30000',
    remaining: '10000',
  });
  expect(plan).not.toHaveProperty('signature');
  expect(plan).not.toHaveProperty('settled');
  expect(requests).toEqual([]);
  await page.screenshot({ path: evidencePath('policy-lab-desktop.png'), fullPage: true });
});

test('policy lab keeps the complete planning flow reachable at phone width', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/lab');
  await expect(page.getByRole('heading', { name: 'Set the boundary' })).toBeVisible();
  await page.getByLabel('Total allowance', { exact: false }).fill('');
  await expect(page.locator('#plan-allowance-error')).toBeVisible();
  await page.getByRole('button', { name: 'Reset limits and requests' }).click();
  for (let i = 0; i < 3; i++)
    await page.getByRole('button', { name: 'Remove request 1', exact: true }).click();
  await expect(page.getByText('A blank slate.', { exact: false })).toBeVisible();
  await expect(page.getByTestId('planned-cost')).toHaveText('0.000000');
  for (let i = 0; i < 8; i++)
    await page.getByRole('button', { name: 'Add wallet snapshot' }).click();
  await expect(page.getByRole('button', { name: 'Add wallet snapshot' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Add transaction explanation' })).toBeDisabled();
  await expect(page.locator('.lab-request')).toHaveCount(8);
  await page.getByRole('button', { name: 'Reset limits and requests' }).click();
  await expect(page.locator('.lab-request')).toHaveCount(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );
  await page.screenshot({
    path: evidencePath('policy-lab-320.png'),
    fullPage: true,
    animations: 'disabled',
  });
});
