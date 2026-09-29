import { defineConfig, devices } from "@playwright/test";

/**
 * Adaptive reading layout (`sat-adaptive-reading-layout.spec.ts`).
 *
 * Its own profile because it asserts REAL layout geometry: the panes' logical
 * widths, the notes column's placement, and the absence of horizontal overflow.
 * That needs a viewport the test chooses (a phone, a tablet landscape, a
 * desktop), not whatever a device profile implies — and it is about how the exam
 * reflows, which is neither the accessibility contract nor the zoom preference
 * the other profiles own.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "sat-adaptive-reading-layout.spec.ts",
  fullyParallel: false,
  // One engine at a time: a cold Vite dev server transforming this app is slow
  // enough that two browsers competing for the same server turn a slow first
  // load into a false failure, and these assertions read layout, not throughput.
  workers: 1,
  timeout: 90_000,
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
