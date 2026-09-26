import { defineConfig, devices } from "@playwright/test";

/**
 * The spectrum rail's pixel gate. Separate from the default suite because it
 * needs no backend at all: the dev-only `/__dev/sat-accessibility` harness
 * renders the real shell, so the dev server is the whole fixture — which is
 * what lets this run as a fast, deterministic screenshot comparison.
 *
 * THE BASELINES ARE THE REFERENCE, NOT OUR OUTPUT. `snapshotPathTemplate`
 * points every `toHaveScreenshot` at `e2e/fixtures/sat-rail-reference/`, so the
 * file being compared against is the supplied Bluebook crop. A screenshot this
 * suite takes of itself can only prove the implementation agrees with itself,
 * which is why nothing here is ever written by `--update-snapshots` on our own
 * run: replace the crops when the reference changes, and nothing else.
 *
 * DPR is pinned to 1 and the spec asserts examZoom=1, because screen zoom scales
 * the plane the rail is painted inside and the crops are cut at that scale.
 *
 *   bun run e2e:sat-spectrum
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "sat-spectrum-rail.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  snapshotPathTemplate: "{testDir}/fixtures/sat-rail-reference/{arg}{ext}",
  expect: {
    toHaveScreenshot: {
      // The reference crop comes from another machine: glyph antialiasing differs
      // even when the layout does not. The rail strip itself is flat colour, so
      // its region can be tightened to 0 once the crops land — this tolerance is
      // for the text the header regions carry.
      maxDiffPixelRatio: 0.02,
      animations: "disabled",
    },
  },
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "retain-on-failure",
    // Reference crops are cut at DPR 1; `scale: css` (the default) keeps the
    // captured PNG in CSS pixels so the two agree.
    deviceScaleFactor: 1,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "bun run dev -- --host 127.0.0.1",
    url: "http://127.0.0.1:3000/__dev/sat-accessibility",
    timeout: 120_000,
    reuseExistingServer: true,
  },
});
