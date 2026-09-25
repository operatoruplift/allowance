import { defineConfig, devices } from '@playwright/test';

const hostedURL = process.env.HOSTED_REHEARSAL_URL;
export default defineConfig({
  testDir: 'tests/browser',
  testMatch: ['hosted-rehearsal.spec.ts', 'brand-kit.spec.ts', 'landing-motion.spec.ts'],
  timeout: 60000,
  expect: { timeout: 15000 },
  reporter: 'list',
  use: {
    baseURL: hostedURL || 'http://127.0.0.1:4328',
    trace: 'retain-on-failure',
    // The rehearsal build ships a service worker, and requests it answers never
    // reach page.route, so it would silently defeat the network mocking these
    // specs rely on. The worker is verified against the deployed site instead.
    serviceWorkers: 'block',
  },
  webServer: hostedURL
    ? undefined
    : {
        command:
          'npx vite preview --outDir .vercel/output/static --host 127.0.0.1 --port 4328 --strictPort',
        url: 'http://127.0.0.1:4328',
        reuseExistingServer: false,
        timeout: 60000,
      },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
