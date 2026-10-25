import { defineConfig, devices } from "@playwright/test";

/**
 * Staff UI parity references: fixture transport only, no database seeding,
 * no backend. Pins browser, timezone, locale, motion, and viewport scale so
 * the screenshots are reproducible.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "staff-ui-parity.spec.ts",
  fullyParallel: true,
  workers: 4,
  retries: 0,
  reporter: "list",
  snapshotPathTemplate: "{testDir}/__screenshots__/staff-ui-parity/{arg}{ext}",
  expect: {
    toHaveScreenshot: { animations: "disabled", caret: "hide", maxDiffPixelRatio: 0.002 },
  },
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "retain-on-failure",
    timezoneId: "Asia/Bangkok",
    locale: "en-US",
    contextOptions: { reducedMotion: "reduce" },
    colorScheme: "light",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], deviceScaleFactor: 1 } }],
  webServer: {
    command: "DISABLE_HMR=true bun run dev -- --host 127.0.0.1",
    url: "http://127.0.0.1:3000/login",
    timeout: 120_000,
    reuseExistingServer: true,
  },
});
