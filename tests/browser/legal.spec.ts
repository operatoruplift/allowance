import { expect, test, type Page } from '@playwright/test';
import { securityHeaders } from '../../scripts/rehearsal-config';

// A store reviewer reaches these pages straight from the listing, before the app
// has ever run. Each document is served here with the static rehearsal's own
// headers, whatever the server under test sends, so "needs no network" is
// enforced by the browser under connect-src 'none' rather than taken on trust.

const rehearsalHeaders = Object.fromEntries(
  Object.entries(securityHeaders).map(([name, value]) => [name.toLowerCase(), value])
);

async function serveDocumentsWithRehearsalHeaders(page: Page) {
  await page.route('**/*', async (route) => {
    if (route.request().resourceType() !== 'document') return route.fallback();
    const response = await route.fetch();
    await route.fulfill({ response, headers: { ...response.headers(), ...rehearsalHeaders } });
  });
}

type ViolationLog = { __violations: string[] };

test('the privacy policy and terms render under the rehearsal policy without calling the network', async ({
  page,
  baseURL,
}) => {
  await serveDocumentsWithRehearsalHeaders(page);
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as ViolationLog).__violations = seen;
    document.addEventListener('securitypolicyviolation', (event) =>
      seen.push(`${event.effectiveDirective} ${event.blockedURI}`)
    );
  });
  const origin = new URL(baseURL!).origin;
  const outside: string[] = [];
  page.on('request', (request) => {
    if (
      ['fetch', 'xhr', 'websocket', 'eventsource'].includes(request.resourceType()) ||
      new URL(request.url()).origin !== origin
    )
      outside.push(`${request.resourceType()} ${request.url()}`);
  });

  for (const [path, heading] of [
    ['/privacy', 'Privacy policy'],
    ['/terms', 'Terms of use'],
  ]) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(200);
    expect(response?.headers()['content-security-policy']).toContain("connect-src 'none'");
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    await expect(page).toHaveTitle(`${heading} · Allowance`);
    await expect(page.getByText('Last updated: 7 October 2026').first()).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    // Every section the contents list names is on the page, so each anchor lands.
    const contents = page.getByRole('navigation', { name: 'On this page' }).locator('ol a');
    expect(await contents.count()).toBeGreaterThan(8);
    for (const target of await contents.evaluateAll((links) =>
      links.map((link) => link.getAttribute('href'))
    ))
      await expect(page.locator(target!)).toHaveCount(1);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true);
    expect(await page.evaluate(() => (window as unknown as ViolationLog).__violations)).toEqual([]);
  }
  await page.setViewportSize({ width: 320, height: 640 });
  for (const path of ['/privacy', '/terms']) {
    await page.goto(path);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      `${path} scrolls sideways at 320 px`
    ).toBe(true);
  }
  expect(outside).toEqual([]);
});

// One test per page, so each page load has its own time budget and a failure
// names the page that lost its links.
for (const path of [
  '/',
  '/demo',
  '/lab',
  '/developers',
  '/brand',
  '/app',
  '/login',
  '/runs/example-receipt',
  '/privacy',
  '/terms',
  '/a-page-that-does-not-exist',
]) {
  test(`${path} links the privacy policy and terms from its footer`, async ({ page }) => {
    await page.goto(path);
    const footer = page.locator('footer.site-footer');
    await expect(footer.getByRole('link', { name: 'Privacy policy' })).toHaveAttribute(
      'href',
      '/privacy'
    );
    await expect(footer.getByRole('link', { name: 'Terms of use' })).toHaveAttribute(
      'href',
      '/terms'
    );
  });
}

test('the footer links open both legal pages from inside the walkthrough', async ({ page }) => {
  await page.goto('/demo');
  await page.locator('footer.site-footer').getByRole('link', { name: 'Privacy policy' }).click();
  await expect(page).toHaveURL(/\/privacy$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Privacy policy' })).toBeVisible();
  await page.locator('footer.site-footer').getByRole('link', { name: 'Terms of use' }).click();
  await expect(page).toHaveURL(/\/terms$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Terms of use' })).toBeVisible();
});
