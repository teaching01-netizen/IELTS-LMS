import { defineConfig, devices } from "@playwright/test";

/**
 * Auto-fit screen zoom (`sat-auto-fit.spec.ts`).
 *
 * Separate from the accessibility suite on purpose: this one asserts REAL
 * layout geometry (the exam's zoom box against its pane region), so it has to
 * run at the reference viewport rather than at whatever a device profile picks,
 * and it is about a display preference rather than an accessibility contract.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "sat-auto-fit.spec.ts",
  fullyParallel: false,
  // One engine at a time: a cold Vite dev server transforming this app is slow
  // enough that two browsers competing for the same server turn a slow first
  // load into a false failure, and the geometry assertions read layout, not
  // throughput.
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: {
    command: "bun run dev -- --host 127.0.0.1",
    url: "http://127.0.0.1:3000/__dev/sat-accessibility",
    timeout: 120_000,
    reuseExistingServer: true,
  },
});
