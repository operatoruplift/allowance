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
    path: 'evidence/controlled-browser-auth-no-payments.png',
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
  expect(externalRequests).toEqual([]);
});
