import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/browser',
  testIgnore: ['hosted-rehearsal.spec.ts', 'brand-kit.spec.ts'],
  timeout: 120000,
  expect: { timeout: 20000 },
  fullyParallel: false,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4318',
    trace: 'retain-on-failure',
    // Requests the service worker answers never reach page.route, so a worker
    // silently defeats the network mocking these specs rely on: aborting
    // **/*.mp4 left the video playing from cache. Nothing here asserts worker
    // behaviour, so keep it out of the way; the worker is verified against the
    // deployed site instead.
    serviceWorkers: 'block',
  },
  webServer: {
    command: 'npm start',
    url: 'http://127.0.0.1:4318/api/health',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
