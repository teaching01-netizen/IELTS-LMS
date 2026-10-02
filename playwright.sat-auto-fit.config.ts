import { defineConfig, devices } from "@playwright/test";

/**
 * Auto-fit screen zoom (`sat-auto-fit.spec.ts`).
 *
 * Separate from the accessibility suite on purpose: this one asserts REAL
 * layout geometry (the exam's zoom box against its pane region), so it has to
 * run at the reference viewport rather than at whatever a device profile picks,
 * and it is about a display preference rather than an accessibility contract.
 */
const port = process.env["SAT_E2E_PORT"] ?? "3000";
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: [
    "sat-auto-fit.spec.ts",
    "sat-reference-fit.spec.ts",
    "sat-reference-ipad.spec.ts",
    "sat-math-tools.spec.ts",
  ],
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
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      testMatch: ["sat-auto-fit.spec.ts", "sat-reference-fit.spec.ts", "sat-math-tools.spec.ts"],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "webkit",
      testMatch: ["sat-auto-fit.spec.ts", "sat-reference-fit.spec.ts", "sat-math-tools.spec.ts"],
      use: { ...devices["Desktop Safari"] },
    },
    {
      name: "ipad-mini",
      testMatch: ["sat-reference-ipad.spec.ts", "sat-math-tools.spec.ts"],
      use: { ...devices["iPad Mini landscape"], viewport: { width: 1133, height: 744 } },
    },
    {
      name: "ipad-pro-11",
      testMatch: ["sat-reference-ipad.spec.ts", "sat-math-tools.spec.ts"],
      use: { ...devices["iPad Pro 11 landscape"], viewport: { width: 1194, height: 834 } },
    },
  ],
  webServer: {
    command: `bun run dev -- --host 127.0.0.1 --port ${port}`,
    url: `${baseURL}/__dev/sat-accessibility`,
    timeout: 120_000,
    reuseExistingServer: true,
  },
});
