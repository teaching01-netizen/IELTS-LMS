import { defineConfig, devices } from "@playwright/test";

/**
 * SAT Desmos burst-chaos suite (plan 2026-11-04 Track C, E2E-A/E2E-B).
 *
 * Runs `e2e/sat-desmos-burst.spec.ts` against the dev-only accessibility
 * harness (no backend needed): blackhole/503/CSP-block failure bounds,
 * single-doc burst budget, and blocked/locale/close pins. Follows the
 * `playwright.sat-calculator-touch.config.ts` / desktop-guard shape —
 * `fullyParallel: false` (chaos timing is order-sensitive), `retries: 0`
 * (a retry would hide a real bound violation), generous per-test budgets
 * for the 14s watchdog + Retry recovery.
 *
 * Throttled run (1 of the 3-run gate): SAT_DESMOS_THROTTLE=1 emulates
 * Fast-3G + 300ms RTT via CDP inside the spec (Chromium only).
 */
const port = Number(process.env["PLAYWRIGHT_SAT_CHAOS_PORT"] ?? "3000");
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("PLAYWRIGHT_SAT_CHAOS_PORT must be a valid TCP port.");
}
const baseURL = `http://127.0.0.1:${port}`;

// Throttled profile (SAT_DESMOS_THROTTLE=1, Fast-3G + 300ms RTT via CDP):
// vite dev serves thousands of unbundled modules, so wall-clock page load
// stretches far beyond what production (built assets + CDN) needs. The
// product bounds under test (14s watchdog on the page clock, doc budget)
// are wall-clock independent — only the harness timeouts stretch here.
const THROTTLED = process.env["SAT_DESMOS_THROTTLE"] === "1";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "sat-desmos-burst.spec.ts",
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  timeout: THROTTLED ? 420_000 : 180_000,
  expect: {
    timeout: THROTTLED ? 120_000 : 30_000,
  },
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: {
    command: `bunx vite --port=${port} --host=127.0.0.1`,
    url: `${baseURL}/__dev/sat-accessibility?mode=math`,
    timeout: 120_000,
    reuseExistingServer: true,
  },
});
