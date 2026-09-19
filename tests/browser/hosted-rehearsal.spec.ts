import { expect, test } from '@playwright/test';
import fs from 'node:fs/promises';

test('hosted private routes explain the backend boundary without accessing any API', async ({
  page,
  baseURL,
}) => {
  const apiRequests: string[] = [];
  page.on('request', (request) => {
    if (
      new URL(request.url()).pathname.startsWith('/api/') ||
      ['fetch', 'xhr'].includes(request.resourceType())
    ) {
      apiRequests.push(request.url());
    }
  });

  for (const route of ['/login', '/app', '/runs/hosted-private-receipt']) {
    await page.goto(new URL(route, baseURL).href);
    await expect(
      page.getByRole('heading', { name: 'Live runs need a persistent backend.' })
    ).toBeVisible();
    await expect(page).toHaveTitle('About live runs · Allowance');
    await expect(page.getByLabel('Operator password')).toHaveCount(0);
    await expect(page.getByText('Fixture receipts, clearly labeled.')).toBeVisible();
    await page.getByRole('link', { name: 'Read the backend setup guide' }).click();
    await expect(page.getByText('This site hosts the public rehearsal.')).toBeVisible();
    await page.goBack();
    await page.getByRole('link', { name: 'Try the rehearsal', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Run the rehearsal', exact: true })
    ).toBeVisible();
  }

  await page.goto(new URL('/app', baseURL).href);
  await page.getByRole('heading', { name: /Explore the agent/ }).click();
  await page.screenshot({
    path: 'evidence/hosted-rehearsal-console.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(new URL('/app', baseURL).href);
  await expect(
    page.getByRole('heading', { name: 'Live runs need a persistent backend.' })
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );
  await page.getByRole('heading', { name: /Explore the agent/ }).click();
  await page.screenshot({
    path: 'evidence/hosted-console-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  expect(apiRequests).toEqual([]);
});

test('hosted rehearsal exports fixture accounting without a signature or network service', async ({
  page,
  baseURL,
}) => {
  const serviceRequests: string[] = [];
  const hostedOrigin = new URL(baseURL!).origin;
  page.on('request', (request) => {
    if (
      new URL(request.url()).origin !== hostedOrigin ||
      new URL(request.url()).pathname.startsWith('/api/') ||
      ['fetch', 'xhr'].includes(request.resourceType())
    ) {
      serviceRequests.push(request.url());
    }
  });

  await page.goto(new URL('/', baseURL).href);
  await expect(page.getByText('This site is a public rehearsal.')).toBeVisible();
  await page.getByRole('heading', { name: 'Give your agent a budget.' }).click();
  await page.screenshot({
    path: 'evidence/hosted-landing-desktop.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('link', { name: 'Try the example', exact: true }).click();
  await page.getByRole('button', { name: 'Run the rehearsal', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your wallet activity brief' })).toBeVisible();
  await page.getByRole('button', { name: 'Test the boundary' }).click();
  await expect(
    page.getByRole('heading', { name: 'The limit held. No third payment.' })
  ).toBeVisible();
  await page.getByRole('button', { name: /^Receipt/ }).click();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export JSON' }).click();
  const file = await (await downloaded).path();
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
  expect(receipt.purchases.every((purchase: { signature?: string }) => !purchase.signature)).toBe(
    true
  );
  await expect(page.locator('a[href*="explorer.solana.com"]')).toHaveCount(0);
  expect(serviceRequests).toEqual([]);
  await page.getByRole('heading', { name: 'A little budget. Useful work.' }).click();
  await page.screenshot({
    path: 'evidence/hosted-rehearsal-receipt.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.emulateMedia({ media: 'print' });
  const printedTimeline = await page
    .locator('.activity-card .timeline li')
    .first()
    .evaluate((element) => {
      const style = getComputedStyle(element);
      return { animation: style.animationName, opacity: style.opacity };
    });
  expect(printedTimeline).toEqual({ animation: 'none', opacity: '1' });
  await page.pdf({
    path: 'evidence/hosted-rehearsal-print.pdf',
    format: 'A4',
    printBackground: true,
  });
});
