import { defineConfig, devices } from "@playwright/test";

/**
 * The spectrum rail's pixel gate. Separate from the default suite because it
 * needs no backend at all: the dev-only `/__dev/sat-accessibility` harness
 * renders the real shell, so the dev server is the whole fixture — which is
 * what lets this run as a fast, deterministic screenshot comparison.
 *
 * Baselines are per-platform (they include antialiased text), so a new OS or a
 * font change regenerates them once with:
 *   bun run e2e:sat-spectrum -- --update-snapshots
 * The geometry assertions in the spec run everywhere and need no baseline.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "sat-spectrum-rail.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  expect: {
    // The gate is structural, not anti-aliasing tolerance: the same rail should
    // rasterise identically, so only sub-pixel text smoothing may differ.
    toHaveScreenshot: { maxDiffPixels: 0 },
  },
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "bun run dev -- --host 127.0.0.1",
    url: "http://127.0.0.1:3000/__dev/sat-accessibility",
    timeout: 120_000,
    reuseExistingServer: true,
  },
});
