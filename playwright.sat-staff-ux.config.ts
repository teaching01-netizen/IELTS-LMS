import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: ["sat-staff-room-ux.spec.ts", "sat-staff-results-ux.spec.ts"],
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  // The dev server serves ~170 unbundled modules on a cold room load; under
  // parallel workers a trace measured 8.6 s to first room data, past the 5 s
  // default. Interaction timing is budgeted by the production-build perf suite.
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
