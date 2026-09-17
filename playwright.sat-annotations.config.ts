import { defineConfig, devices } from "@playwright/test";

/**
 * Annotation placement invariants. Separate from the accessibility suite because
 * this one must run on BOTH pointer types: the whole point of the placement
 * engine is that the presentation follows the available space rather than the
 * device, and only a touch project can prove that a coarse pointer no longer
 * forces the dock.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "sat-annotation-placement.spec.ts",
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "touch-chromium", use: { ...devices["Pixel 5"] } },
  ],
  webServer: {
    command: "bun run dev -- --host 127.0.0.1",
    url: "http://127.0.0.1:3000/__dev/sat-accessibility",
    timeout: 120_000,
    reuseExistingServer: true,
  },
});
