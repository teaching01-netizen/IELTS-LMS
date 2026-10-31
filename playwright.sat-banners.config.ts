import { defineConfig, devices } from '@playwright/test';

/**
 * Screenshot capture for the dev-only SAT banner gallery
 * (/__dev/sat-banners). Not part of the CI gate; run on demand:
 *
 *   bun run e2e:sat-banners
 *
 * Images land in verification/sat-banners/.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: ['sat-banners.spec.ts'],
  reporter: 'list',
  workers: 1,
  retries: 0,
  timeout: 60_000,
  use: {
    baseURL: 'http://127.0.0.1:3101',
    trace: 'retain-on-failure',
    colorScheme: 'light',
    viewport: { width: 1180, height: 900 },
  },
  projects: [
    {
      name: 'banners-chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1180, height: 900 }, deviceScaleFactor: 2 },
    },
  ],
  webServer: {
    command: 'bun run dev -- --host 127.0.0.1 --port 3101',
    url: 'http://127.0.0.1:3101',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
