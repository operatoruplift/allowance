import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'allow' });

test('the first installed shell can reopen the policy lab offline', async ({ page, context }) => {
  await page.goto('/lab');
  await expect(page.getByRole('heading', { name: /Find the right/ })).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((resolve) => {
        navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), {
          once: true,
        });
      });
    }
  });
  const cached = await page.evaluate(async () => {
    const cache = await caches.open('allowance-shell-v2');
    return (await cache.keys()).map((entry) => new URL(entry.url).pathname);
  });
  expect(cached).toContain('/');
  expect(cached).toContain('/allowance-a.svg');
  expect(cached.some((path) => /\/assets\/.+\.js$/.test(path))).toBe(true);
  expect(cached.some((path) => /\/assets\/.+\.css$/.test(path))).toBe(true);
  expect(cached.some((path) => path.startsWith('/fonts/'))).toBe(true);
  expect(cached.some((path) => /\/(?:api|merchant|tools)(?:\/|$)/.test(path))).toBe(false);
  expect(cached.some((path) => /\.(?:mp4|webm|zip)$/.test(path))).toBe(false);

  await context.setOffline(true);
  await page.goto('/lab');
  await expect(page.getByRole('heading', { name: /Find the right/ })).toBeVisible();
  await expect(page.locator('.workspace-brand img')).toHaveJSProperty('complete', true);
  expect(
    await page
      .locator('.workspace-brand img')
      .evaluate((image) => (image as HTMLImageElement).naturalWidth)
  ).toBeGreaterThan(0);
  await expect(page.getByTestId('planned-cost')).toHaveText('0.030000');
  await page.getByLabel('Total allowance').fill('0.010000');
  await expect(page.getByTestId('planned-cost')).toHaveText('0.010000');
  await expect(page.getByTestId('plan-remaining')).toHaveText('0.000000');
  await expect(page.getByText('No funds moved.', { exact: true })).toBeVisible();
});
