import { defineConfig, devices } from '@playwright/test';

/**
 * Stack-free runner for the touch-selection spec.
 *
 * Every page that spec loads is the static fixture under
 * `e2e/fixtures/touch-selection/`, served by Vite as an HTML entry — it never
 * reaches the Go API, the worker, the database, or anything globalSetup seeds.
 * The main playwright.config.ts is Go-backed local integration coverage and
 * would start all three for a suite that uses none of them, so this config runs
 * the same spec against the same baseURL with Vite alone — the stack-free way to
 * exercise the caret-centred loupe contract:
 *
 *   bunx playwright test -c e2e/selection.run.config.ts
 *
 * Roughly twenty seconds, no Go, no MySQL, no seeded database.
 */
export default defineConfig({
  testDir: '..',
  testMatch: '**/student-owned-touch-selection.spec.ts',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    // The loupe and owned-selection tests are mobile-gated (`test.skip(!isMobile)`),
    // so both form factors matter: desktop for the fixture-level contracts, a
    // real phone profile for the touch ones.
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'bun run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
