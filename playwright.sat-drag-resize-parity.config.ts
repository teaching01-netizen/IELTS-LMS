import { defineConfig, devices } from "@playwright/test";

/**
 * Runner for e2e/sat-calculator-drag-resize-parity.spec.ts (E2EDD step 2).
 *
 * SCAFFOLDING NOTE (Track C): task-4 scopes the deliverable to the spec
 * file, but no existing config's testMatch admits it (every sat config pins
 * one file; the root config boots the Go backend). This file is a
 * pattern-copy of playwright.sat-desmos-chaos.config.ts (vite-only harness,
 * no backend) so the parity spec can be listed and run; fold it into the
 * plan's verification matrix or delete it once the unification PR lands.
 */
const port = Number(process.env["PLAYWRIGHT_SAT_PARITY_PORT"] ?? "3000");
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("PLAYWRIGHT_SAT_PARITY_PORT must be a valid TCP port.");
}
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "sat-calculator-drag-resize-parity.spec.ts",
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  timeout: 120_000,
  expect: {
    timeout: 30_000,
  },
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `bunx vite --port=${port} --host=127.0.0.1`,
    url: `${baseURL}/__dev/sat-accessibility?mode=math`,
    timeout: 120_000,
    reuseExistingServer: true,
  },
});
