import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/browser',
  timeout: 120000,
  expect: { timeout: 20000 },
  fullyParallel: false,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4318', trace: 'retain-on-failure' },
  webServer: {
    command: 'npm start',
    url: 'http://127.0.0.1:4318/api/health',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
