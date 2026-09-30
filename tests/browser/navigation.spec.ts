import { expect, test } from '@playwright/test';

test('direct public routes and the branded missing page have accurate browser titles', async ({
  page,
}) => {
  for (const [route, title] of [
    ['/lab', 'Policy lab'],
    ['/lab/', 'Policy lab'],
    ['/demo', 'Agent walkthrough'],
    ['/developers', 'For developers'],
    ['/brand', 'Brand kit'],
    ['/a-page-that-does-not-exist', 'Page not found'],
    ['/runs/a/b', 'Page not found'],
  ]) {
    await page.goto(route);
    await expect(page).toHaveTitle(`${title} · Allowance`);
  }
  await expect(page.getByRole('heading', { name: 'This page isn’t here.' })).toBeVisible();
  await page.getByRole('link', { name: 'Go to the home page' }).click();
  await expect(page).toHaveTitle('Allowance — Give your agent a budget.');
  await expect(page.getByRole('heading', { name: 'Give your agent a budget.' })).toBeVisible();
});
