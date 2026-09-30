import { evidencePath } from './evidence';
import { test, expect, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { RunDTO } from '../../shared/domain.js';

let origin = 'http://127.0.0.1:4319';
const task = 'Controlled browser auth test: no purchases or live settlement.';
let testDirectory: string;
let server: ChildProcess;
let runId: string;
const password = randomBytes(24).toString('hex');

class PrivateWorkspace {
  constructor(readonly page: Page) {}
  async login() {
    await this.page.goto(`${origin}/app`);
    await expect(this.page).toHaveURL(`${origin}/login`);
    await this.page.getByLabel('Operator password').fill(password);
    await this.page.getByRole('button', { name: 'Open console' }).click();
    await expect(this.page).toHaveURL(`${origin}/app`);
    await expect(this.page.getByRole('heading', { name: 'Recent runs' })).toBeVisible();
  }
  async openSavedRun() {
    await this.page.getByRole('link').filter({ hasText: task }).click();
    await expect(this.page).toHaveURL(`${origin}/runs/${runId}`);
    await expect(this.page.getByText(task, { exact: true })).toBeVisible();
  }
  async exportReceipt(): Promise<RunDTO> {
    await this.page.getByRole('button', { name: /^Receipt/ }).click();
    const downloaded = this.page.waitForEvent('download');
    await this.page.getByRole('button', { name: 'Export JSON' }).click();
    const download = await downloaded;
    expect(download.suggestedFilename()).toBe(`allowance-${runId}-receipt.json`);
    const file = await download.path();
    expect(file).not.toBeNull();
    return JSON.parse(await fs.readFile(file!, 'utf8')) as RunDTO;
  }
}

// Playwright requires fixture destructuring even when this hook needs no fixtures.
// eslint-disable-next-line no-empty-pattern
test.beforeAll(async ({}, testInfo) => {
  const port = 4319 + testInfo.workerIndex;
  origin = `http://127.0.0.1:${port}`;
  testDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'allowance-browser-'));
  server = spawn(process.execPath, ['--import', 'tsx', 'tests/browser/private-server.ts'], {
    cwd: process.cwd(),
    env: {
      PATH: process.env.PATH,
      ALLOWANCE_PRIVATE_TEST_DIR: testDirectory,
      ALLOWANCE_PRIVATE_TEST_PASSWORD: password,
      ALLOWANCE_PRIVATE_TEST_PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  let errors = '';
  server.stderr!.on('data', (chunk) => {
    errors += String(chunk);
  });
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Private server startup timed out: ${errors}`)),
      15000
    );
    server.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    server.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Private server exited (${code}): ${errors}`));
    });
    server.stdout!.on('data', (chunk) => {
      output += String(chunk);
      const line = output
        .split('\n')
        .slice(0, -1)
        .find((candidate) => candidate.startsWith('{"ready":true,'));
      if (line) {
        runId = (JSON.parse(line) as { runId: string }).runId;
        clearTimeout(timeout);
        resolve();
      }
    });
  });
});

test.afterAll(async () => {
  if (server && server.exitCode === null && server.signalCode === null) {
    const exited = once(server, 'exit');
    server.kill('SIGTERM');
    const fallback = setTimeout(() => server.kill('SIGKILL'), 5000);
    await exited;
    clearTimeout(fallback);
  }
  if (testDirectory) await fs.rm(testDirectory, { recursive: true, force: true });
});

test('controlled real auth: saved run survives refresh, stops, exports, and stays private', async ({
  page,
  context,
  browser,
}) => {
  const externalRequests: string[] = [];
  await context.route('**/*', (route) => {
    if (new URL(route.request().url()).origin !== origin) {
      externalRequests.push(route.request().url());
      return route.abort();
    }
    return route.continue();
  });
  const workspace = new PrivateWorkspace(page);
  await workspace.login();
  const config = await context.request.get(`${origin}/api/config`);
  expect(config.status()).toBe(200);
  expect(await config.json()).toMatchObject({ ready: false, payer: null });
  await workspace.openSavedRun();
  await expect(page.getByRole('button', { name: 'Stop run', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText(task, { exact: true })).toBeVisible();
  const beforeStop = await context.request.get(`${origin}/api/runs/${runId}`);
  expect(beforeStop.status()).toBe(200);
  expect(await beforeStop.json()).toMatchObject({ id: runId, status: 'queued', purchases: [] });

  const stopped = page.waitForResponse(
    (response) => response.url() === `${origin}/api/runs/${runId}/stop` && response.status() === 200
  );
  await page.getByRole('button', { name: 'Stop run', exact: true }).click();
  expect(await (await stopped).json()).toMatchObject({ status: 'stopped', purchases: [] });
  await expect(page.getByRole('button', { name: 'Stop run', exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByText(task, { exact: true })).toBeVisible();
  const receipt = await workspace.exportReceipt();
  await expect(
    page.getByText(`Payments: ${receipt.paymentNetwork}`, { exact: true })
  ).toBeVisible();
  await expect(page.locator('.currency-label')).toContainText(receipt.paymentNetwork);
  await expect(page.getByText('Data: devnet', { exact: true })).toBeVisible();
  expect(receipt.paymentNetwork).toBe('mainnet');
  expect(receipt.dataNetwork).toBe('devnet');
  expect(receipt).toMatchObject({
    id: runId,
    task,
    status: 'stopped',
    authorized: '40000',
    settled: '0',
    held: '0',
    remaining: '40000',
    purchases: [],
    llm: { calls: 0, inputTokens: 0, outputTokens: 0 },
  });
  await page.getByRole('heading', { name: 'Every step, in the open.' }).click();
  await page.screenshot({
    path: evidencePath('controlled-browser-auth-no-payments.png'),
    fullPage: true,
    animations: 'disabled',
  });

  const guest = await browser.newContext();
  try {
    const guestPage = await guest.newPage();
    await guestPage.goto(`${origin}/runs/${runId}`);
    await expect(guestPage).toHaveURL(`${origin}/login`);
    await expect(guestPage.getByText(task, { exact: true })).toHaveCount(0);
    for (const endpoint of ['/api/runs', `/api/runs/${runId}`, `/api/runs/${runId}/export`]) {
      const response = await guest.request.get(`${origin}${endpoint}`);
      expect(response.status()).toBe(401);
      expect(await response.text()).not.toContain(task);
    }
  } finally {
    await guest.close();
  }
  // A server-expired session cannot leave stale financial data in the workspace.
  await context.clearCookies();
  await page.getByRole('button', { name: 'Export JSON' }).click();
  await expect(page).toHaveURL(`${origin}/login`);
  await expect(page.getByText(task, { exact: true })).toHaveCount(0);
  expect(externalRequests).toEqual([]);
});

test('workspace navigation retains assignment drafts, filters saved runs, and supports browser history', async ({
  page,
}) => {
  const workspace = new PrivateWorkspace(page);
  await workspace.login();
  const navigation = page.getByRole('navigation', { name: 'Workspace navigation' });
  const draft = 'Review this wallet and summarize activity within my budget.';
  await page.getByLabel('What should the agent do?').fill(draft);
  await page.getByLabel('Total allowance').fill('0.050000');
  await navigation.getByRole('link', { name: 'Runs', exact: true }).click();
  await expect(page).toHaveURL(/\/app\?view=runs$/);
  await expect(page.getByRole('heading', { name: 'Your work, accounted for.' })).toBeFocused();
  await page.getByRole('searchbox', { name: 'Search runs' }).fill('absent-task');
  await expect(page.getByText('No runs match these filters.')).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(page.getByRole('link').filter({ hasText: task })).toBeVisible();
  await page.getByLabel('Run status').selectOption('completed');
  await expect(page.getByText('No runs match these filters.')).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await navigation.getByRole('link', { name: 'Payments', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Pay within your boundaries.' })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('searchbox', { name: 'Search runs' })).toBeVisible();
  await navigation.getByRole('link', { name: 'Overview', exact: true }).click();
  await expect(page.getByLabel('What should the agent do?')).toHaveValue(draft);
  await expect(page.getByLabel('Total allowance')).toHaveValue('0.050000');
  await navigation.getByRole('link', { name: 'Setup', exact: true }).click();
  await page.reload();
  await expect(navigation.getByRole('link', { name: 'Setup', exact: true })).toHaveAttribute(
    'aria-current',
    'page'
  );
  await expect(page.getByRole('button', { name: 'Check readiness' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(navigation).toBeVisible();
  await navigation.getByRole('link', { name: 'Overview', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );
  await page.screenshot({
    path: evidencePath('operator-workspace-mobile.png'),
    fullPage: true,
    animations: 'disabled',
  });
});

test('expired readiness authorization clears private workspace information', async ({
  page,
  context,
}) => {
  await new PrivateWorkspace(page).login();
  await page
    .getByRole('navigation', { name: 'Workspace navigation' })
    .getByRole('link', { name: 'Setup', exact: true })
    .click();
  await context.clearCookies();
  await page.getByRole('button', { name: 'Check readiness' }).click();
  await expect(page).toHaveURL(`${origin}/login`);
  await expect(page.getByText(task, { exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Payment wallet', exact: true })).toHaveCount(0);
});

test('one-time grant copy reports blocked clipboard access and survives workspace navigation', async ({
  page,
}) => {
  // Only the grant response and readiness flag are controlled here. No payment or model runtime exists.
  const token = 'browser-test-only-grant-not-a-credential';
  await page.route(`${origin}/api/config`, async (route) => {
    const response = await route.fetch();
    if (response.status() !== 200) return route.fulfill({ response });
    await route.fulfill({ response, json: { ...(await response.json()), externalReady: true } });
  });
  await page.route(`${origin}/api/external-runs`, async (route) => {
    await route.fulfill({
      json: { run: { id: runId }, grant: { token, expiresAt: '2099-01-01T00:00:00.000Z' } },
    });
  });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error('Clipboard denied for this test');
        },
      },
    });
  });
  await new PrivateWorkspace(page).login();
  await page.getByLabel('Solana wallet').fill('11111111111111111111111111111111');
  await page.getByRole('button', { name: 'Authorize external MCP agent', exact: true }).click();
  const copy = page.getByRole('button', { name: 'Copy external agent grant token' });
  await expect(copy).toBeVisible();
  await copy.click();
  await expect(
    page.getByText('Copy was blocked. Select the token text and copy it manually.')
  ).toBeVisible();
  const navigation = page.getByRole('navigation', { name: 'Workspace navigation' });
  await navigation.getByRole('link', { name: 'Payments', exact: true }).click();
  await navigation.getByRole('link', { name: 'Overview', exact: true }).click();
  await expect(copy).toContainText(token);
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          document.body.dataset.copiedGrant = text;
        },
      },
    });
  });
  await copy.click();
  await expect(
    page.getByText('Token copied. Keep it in your agent’s private environment.')
  ).toBeVisible();
  await expect(page.locator('body')).toHaveAttribute('data-copied-grant', token);
});

test('authorization recovery discards private drafts even when session refresh fails and is retried', async ({
  page,
}) => {
  await new PrivateWorkspace(page).login();
  const navigation = page.getByRole('navigation', { name: 'Workspace navigation' });
  const fields = [
    page.getByLabel('Solana wallet'),
    page.getByLabel('What should the agent do?'),
    page.getByLabel('Total allowance'),
    page.getByLabel('Per-request cap'),
    page.getByLabel('Authorization expires after'),
  ];
  const initial = await Promise.all(fields.map((field) => field.inputValue()));
  await fields[0].fill('So11111111111111111111111111111111111111112');
  await fields[1].fill(
    'A private task draft that must be discarded after authorization is rejected.'
  );
  await fields[2].fill('0.080000');
  await fields[3].fill('0.030000');
  await fields[4].selectOption('30');
  await page
    .getByRole('checkbox', { name: 'Permit Transaction explanation', exact: true })
    .uncheck();
  await navigation.getByRole('link', { name: 'Runs', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Search runs' }).fill('private-search');
  await page.getByLabel('Run status').selectOption('attention');
  await navigation.getByRole('link', { name: 'Setup', exact: true }).click();
  await page.route(`${origin}/api/preflight`, (route) =>
    route.fulfill({ status: 403, json: { error: 'Authorization must be refreshed.' } })
  );
  let rejectedRefresh = false;
  await page.route(`${origin}/api/session`, async (route) => {
    if (!rejectedRefresh) {
      rejectedRefresh = true;
      return route.fulfill({
        status: 503,
        json: { error: 'Session connection temporarily unavailable.' },
      });
    }
    return route.continue();
  });
  await page.getByRole('button', { name: 'Check readiness' }).click();
  await expect(page.getByRole('alert')).toContainText(
    'Session connection temporarily unavailable.'
  );
  await expect(page.getByLabel('What should the agent do?')).toHaveCount(0);
  await page.getByRole('button', { name: 'Retry connection' }).click();
  await expect(page.getByRole('heading', { name: 'Ready for useful work.' })).toBeVisible();
  await navigation.getByRole('link', { name: 'Overview', exact: true }).click();
  for (const [index, field] of fields.entries()) await expect(field).toHaveValue(initial[index]);
  await expect(
    page.getByRole('checkbox', { name: 'Permit Transaction explanation', exact: true })
  ).toBeChecked();
  await navigation.getByRole('link', { name: 'Runs', exact: true }).click();
  await expect(page.getByRole('searchbox', { name: 'Search runs' })).toHaveValue('');
  await expect(page.getByLabel('Run status')).toHaveValue('all');
});
