import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs/promises';

const evidenceDirectory = 'evidence/scroll-motion-2026-09-23';
const landing = (page: Page) => page.locator('main.landing-page');
const storyStep = (page: Page, step: number) =>
  page.locator(`#allowance-story [data-story-step="${step}"]`);

async function centerStoryStep(page: Page, step: number) {
  const article = storyStep(page, step);
  // A native anchor scroll started by an earlier click can still be settling
  // here, and it carries the page past the step this just centred. Re-centre
  // until the stage agrees, so the assertion measures the active-step rule
  // rather than which scroll happened to finish first.
  await expect
    .poll(async () => {
      await article.evaluate((element) =>
        element.scrollIntoView({ block: 'center', behavior: 'instant' })
      );
      return page.locator('.allowance-story-stage').getAttribute('data-active-step');
    })
    .toBe(String(step));
  await expect(article).toBeInViewport();
}

async function expectUnobscuredReveals(page: Page) {
  await expect(landing(page).locator('[data-reveal]')).not.toHaveCount(0);
  await expect
    .poll(() =>
      landing(page)
        .locator('[data-reveal]')
        .evaluateAll((elements) =>
          elements
            .filter((element) => {
              const style = getComputedStyle(element);
              return (
                style.opacity !== '1' ||
                style.visibility !== 'visible' ||
                style.transform !== 'none'
              );
            })
            .map((element) => element.textContent?.trim().slice(0, 80))
        )
    )
    .toEqual([]);
}

test.beforeAll(async () => {
  await fs.mkdir(evidenceDirectory, { recursive: true });
});

test('landing scroll stays native, advances the story, and leads to a working example', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await expect(landing(page)).toHaveAttribute('data-landing-motion', 'standard');
  await expect(page.getByRole('heading', { name: 'Give your agent a budget.' })).toBeVisible();

  await page.mouse.move(1100, 650);
  await page.mouse.wheel(0, 450);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(200);
  const afterWheel = await page.evaluate(() => window.scrollY);
  await page.keyboard.press('PageDown');
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(afterWheel + 100);

  const followLink = page.getByRole('link', { name: 'Follow the allowance', exact: true });
  await expect(followLink).toHaveAttribute('href', '#allowance-story');
  await followLink.click();
  await expect(page).toHaveURL(/#allowance-story$/);
  await expect(page.locator('#allowance-story')).toBeInViewport();

  for (const step of [0, 1, 2]) {
    await centerStoryStep(page, step);
    await expect(storyStep(page, step).getByRole('heading')).toBeVisible();
    await page.screenshot({
      path: `${evidenceDirectory}/desktop-story-${step + 1}.png`,
      animations: 'disabled',
    });
  }

  await page.getByRole('link', { name: 'Try the example', exact: true }).click();
  await expect(page).toHaveURL(/\/demo$/);
  await page.getByRole('button', { name: 'Run the rehearsal', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your wallet activity brief' })).toBeVisible();
});

test('reducing motion midway through the story reveals all content immediately', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await centerStoryStep(page, 1);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(landing(page)).toHaveAttribute('data-landing-motion', 'reduced');
  await expect(page.getByRole('button', { name: 'Motion reduced', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false'
  );
  await expectUnobscuredReveals(page);
  await expect(page.locator('#allowance-story [data-story-step]')).toHaveCount(3);
  for (const step of [0, 1, 2]) {
    await expect(storyStep(page, step).getByRole('heading')).toBeVisible();
  }
  await storyStep(page, 1).scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `${evidenceDirectory}/desktop-motion-reduced.png`,
    animations: 'disabled',
  });

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(landing(page)).toHaveAttribute('data-landing-motion', 'standard');
  await page.getByRole('button', { name: 'Reduce motion', exact: true }).click();
  await expect(landing(page)).toHaveAttribute('data-landing-motion', 'reduced');
  await expect(page.getByRole('button', { name: 'Motion reduced', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await page.reload();
  await expect(landing(page)).toHaveAttribute('data-landing-motion', 'reduced');
  await expectUnobscuredReveals(page);
  await page.getByRole('button', { name: 'Motion reduced', exact: true }).click();
  await expect(landing(page)).toHaveAttribute('data-landing-motion', 'standard');
  await centerStoryStep(page, 2);
});

test('reduced-motion phone and tablet layouts keep the story and actions readable', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    await expect(landing(page)).toHaveAttribute('data-landing-motion', 'reduced');
    await expect(page.getByRole('heading', { name: 'Give your agent a budget.' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Try the example', exact: true })).toBeVisible();
    await expectUnobscuredReveals(page);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true);
    await page.screenshot({
      path: `${evidenceDirectory}/landing-${width}.png`,
      animations: 'disabled',
    });

    await page.getByRole('link', { name: 'Follow the allowance', exact: true }).click();
    for (const step of [0, 1, 2]) {
      const article = storyStep(page, step);
      await article.scrollIntoViewIfNeeded();
      await expect(article).toBeInViewport();
      await expect(article.getByRole('heading')).toBeVisible();
      const bounds = await article.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    }
    await page.screenshot({
      path: `${evidenceDirectory}/story-${width}.png`,
      animations: 'disabled',
    });
    await page.getByRole('link', { name: 'Try the example', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Run the rehearsal', exact: true })
    ).toBeVisible();
  }
});

test('landing motion recovers after leaving the route and navigating browser history', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await centerStoryStep(page, 1);
  await page.getByRole('link', { name: 'Brand kit', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'A little more possibility.' })).toBeVisible();
  await page.goBack();
  await expect(landing(page)).toHaveAttribute('data-landing-motion', 'standard');
  await centerStoryStep(page, 2);
  await page.goForward();
  await expect(page.getByRole('heading', { name: 'A little more possibility.' })).toBeVisible();
  await page.getByRole('link', { name: 'Allowance home', exact: true }).first().click();
  await expect(landing(page)).toHaveAttribute('data-landing-motion', 'standard');
  await centerStoryStep(page, 0);
  await centerStoryStep(page, 2);
  await page.goto('/#allowance-story');
  await expect(page.locator('#allowance-story')).toBeInViewport();
  expect(pageErrors).toEqual([]);
});
