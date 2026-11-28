import path from "node:path";
import { defineConfig } from "@playwright/test";

/**
 * Focused acceptance run for the SAT Word Vault workbook import.
 *
 * It reuses `playwright.config.ts` servers, globalSetup and projects. Two
 * differences matter:
 *
 * 1. `FRONTEND_DIST_DIR` and `ANSWEREDPDF_DIST` are set before the base config
 *    is imported, so the API serves the built print bundle and the spec's PDF
 *    branch runs instead of returning early.
 * 2. The expect timeout is raised. The student app is a separate Vite module
 *    graph that is transformed on first request; the base 5 s budget is too
 *    tight for a cold dev server and produces a false failure in the sitting,
 *    not in the import this suite exists to prove.
 *
 *   TEST_DATABASE_URL=mysql://... AUTH_SECRET=... \
 *     bunx playwright test --config playwright.sat-word-vault.config.ts \
 *     --project=chromium -g "Word Vault"
 *
 * Point TEST_DATABASE_URL at a disposable database only: the shared E2E seed
 * is destructive to its own fixture rows.
 */

if (!process.env["FRONTEND_DIST_DIR"]) {
  process.env["FRONTEND_DIST_DIR"] = path.resolve("dist");
}
if (!process.env["ANSWEREDPDF_DIST"]) {
  process.env["ANSWEREDPDF_DIST"] = path.resolve("dist");
}

const { default: baseConfig } = await import("./playwright.config");

const baseServers = Array.isArray(baseConfig.webServer)
  ? baseConfig.webServer
  : baseConfig.webServer
    ? [baseConfig.webServer]
    : [];

const printEnv = {
  FRONTEND_DIST_DIR: process.env["FRONTEND_DIST_DIR"],
  ANSWEREDPDF_DIST: process.env["ANSWEREDPDF_DIST"],
};

export default defineConfig({
  ...baseConfig,
  testMatch: "sat-workbook-import.spec.ts",
  testIgnore: [],
  fullyParallel: false,
  retries: 0,
  workers: 1,
  timeout: 300_000,
  expect: { timeout: 20_000 },
  reporter: "list",
  outputDir: "test-results/sat-word-vault",
  metadata: {
    feature: "SAT Word Vault workbook import",
    requiresDisposableDatabase: true,
  },
  webServer: baseServers.map((server) => ({
    ...server,
    env: { ...(server.env ?? {}), ...printEnv },
  })),
});
