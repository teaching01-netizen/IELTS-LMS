import { defineConfig, devices } from "@playwright/test";

/**
 * Temporary desktop-only runner for the pre-existing calculator regression
 * suite (plan J1: `e2e/sat-math-tools.spec.ts` must stay green on a fine
 * pointer). It uses the same dev-only accessibility harness, so no backend is
 * needed; the main playwright.config.ts owns the Go-backed matrix.
 */
const port = Number(process.env["PLAYWRIGHT_SAT_CALC_TOUCH_PORT"] ?? "3000");
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "sat-math-tools.spec.ts",
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  timeout: 120_000,
  use: { baseURL, trace: "retain-on-failure" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    { name: "tablet-landscape", use: { ...devices["iPad (gen 7)"], viewport: { width: 1080, height: 810 } } },
    { name: "tablet-portrait", use: { ...devices["iPad (gen 7)"] } },
  ],
  webServer: {
    command: `bunx vite --port=${port} --host=127.0.0.1`,
    url: `${baseURL}/__dev/sat-accessibility`,
    timeout: 120_000,
    reuseExistingServer: true,
  },
});
