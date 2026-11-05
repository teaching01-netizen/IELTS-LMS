import { defineConfig, devices } from "@playwright/test";

/**
 * Bulk end-exam E2E suites: the SAT Rooms list and the IELTS/ACT proctor
 * overview. Both run against the dev server with the backend mocked at the
 * network boundary, so they need no database or Go API.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: ["sat-staff-bulk-end-ux.spec.ts", "proctor-bulk-end-ux.spec.ts"],
  fullyParallel: false,
  // One worker: both suites share a single Vite dev server, and two cold
  // workers racing module transforms produced a 30s browser-load timeout on
  // the first run after a restart. Sequential runs are deterministic and the
  // whole set still finishes in about 15 seconds.
  workers: 1,
  retries: 0,
  reporter: "list",
  expect: { timeout: 15_000 },
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "retain-on-failure",
    timezoneId: "Asia/Bangkok",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "bun run dev -- --host 127.0.0.1",
    url: "http://127.0.0.1:3000/__dev/sat-authoring",
    timeout: 120_000,
    reuseExistingServer: true,
  },
});
