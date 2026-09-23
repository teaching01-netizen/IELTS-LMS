import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import dotenv from "dotenv";

const inheritedEnv = { ...process.env };
const frontendPort = Number(process.env["PLAYWRIGHT_FRONTEND_PORT"] ?? "3000");
if (!Number.isInteger(frontendPort) || frontendPort < 1 || frontendPort > 65_535) {
  throw new Error("PLAYWRIGHT_FRONTEND_PORT must be a valid TCP port.");
}
const frontendUrl = `http://localhost:${frontendPort}`;

// Playwright loads its web-server environment before globalSetup runs. Load
// the same local/CI defaults here so the Go API receives a complete config.
dotenv.config({ path: path.resolve(".env"), override: false });
dotenv.config({ path: path.resolve("backend/.env"), override: false });
dotenv.config({ path: path.resolve("backend/.env.example"), override: false });

const backendApiUrl = (process.env["VITE_BACKEND_API_URL"] ?? "http://localhost:4000").replace(
  /\/$/,
  ""
);
const backendApiOrigin = new URL(backendApiUrl).origin;
// The shared E2E seed is destructive to fixture rows, so prefer a dedicated
// test database when the runner supplies one. Otherwise keep compatibility
// with explicit runner DATABASE_URL values and the local Go direct DSN.
const databaseUrl =
  inheritedEnv["TEST_DATABASE_URL"] ??
  process.env["TEST_DATABASE_URL"] ??
  inheritedEnv["DATABASE_URL"] ??
  inheritedEnv["DATABASE_DIRECT_URL"] ??
  process.env["DATABASE_DIRECT_URL"] ??
  process.env["DATABASE_URL"];
// globalSetup and E2E database helpers use process.env directly, so keep their
// connection consistent with the server processes configured below.
if (databaseUrl) process.env["DATABASE_URL"] = databaseUrl;
const coeditPublicUrl =
  inheritedEnv["AUTHORING_COEDIT_PUBLIC_URL"] ?? `${backendApiOrigin}/authoring-coedit`;
const coeditPublicWSScheme =
  inheritedEnv["AUTHORING_COEDIT_PUBLIC_WS_SCHEME"] ??
  (new URL(frontendUrl).protocol === "https:" ? "wss" : "ws");

function coeditMysqlDsn(databaseUrl: string | undefined): string {
  if (!databaseUrl)
    throw new Error("Playwright E2E requires DATABASE_URL for the local co-edit service.");
  if (/^mysql:\/\//i.test(databaseUrl)) return databaseUrl;
  const match =
    /^(?<user>[^:@/]+)(?::(?<password>[^@]*))?@tcp\((?<hostPort>[^)]+)\)\/(?<database>[^?]+)(?:\?.*)?$/.exec(
      databaseUrl.trim()
    );
  if (!match?.groups) throw new Error("DATABASE_URL is not a supported local MySQL DSN.");
  const user = match.groups["user"];
  const password = match.groups["password"];
  const hostPort = match.groups["hostPort"];
  const database = match.groups["database"];
  if (!user || !hostPort || !database)
    throw new Error("DATABASE_URL is not a supported local MySQL DSN.");
  const credentials =
    password === undefined
      ? encodeURIComponent(user)
      : `${encodeURIComponent(user)}:${encodeURIComponent(password)}`;
  return `mysql://${credentials}@${hostPort}/${encodeURIComponent(database)}`;
}

const coeditDatabaseUrl = inheritedEnv["AUTHORING_COEDIT_MYSQL_DSN"] ?? coeditMysqlDsn(databaseUrl);
const backendCookieEnv = {
  COOKIE_SECURE: process.env["COOKIE_SECURE"] ?? "false",
  SESSION_COOKIE_NAME: process.env["SESSION_COOKIE_NAME"] ?? "session",
  CSRF_COOKIE_NAME: process.env["CSRF_COOKIE_NAME"] ?? "csrf",
};
const backendRuntimeEnv = {
  ...process.env,
  ...(databaseUrl ? { DATABASE_URL: databaseUrl } : {}),
  ...backendCookieEnv,
  // Local E2E must not inherit the public placeholder values from
  // backend/.env.example; the embedded service is reachable through the API.
  AUTHORING_COEDIT_PROXY_ENABLED: inheritedEnv["AUTHORING_COEDIT_PROXY_ENABLED"] ?? "true",
  AUTHORING_COEDIT_PUBLIC_URL: coeditPublicUrl,
  AUTHORING_COEDIT_PUBLIC_WS_SCHEME: coeditPublicWSScheme,
  AUTHORING_COEDIT_ALLOWED_ORIGIN: inheritedEnv["AUTHORING_COEDIT_ALLOWED_ORIGIN"] ?? frontendUrl,
  AUTHORING_COEDIT_MYSQL_DSN: coeditDatabaseUrl,
  PORT: process.env["PORT"] ?? "4000",
  API_PORT: process.env["API_PORT"] ?? "4000",
  APP_ENV: process.env["APP_ENV"] ?? "test",
  ENVIRONMENT: process.env["ENVIRONMENT"] ?? "test",
  MIGRATIONS_DIR: process.env["MIGRATIONS_DIR"] ?? "migrations",
  // Keep local runtime-contract tests fast while allowing CI/operators to
  // override the cadence for a slower shared database.
  WORKER_MAINTENANCE_INTERVAL_SECS: inheritedEnv["WORKER_MAINTENANCE_INTERVAL_SECS"] ?? "1",
  WORKER_FALLBACK_INTERVAL_SECS: inheritedEnv["WORKER_FALLBACK_INTERVAL_SECS"] ?? "1",
  LIVE_UPDATE_POLL_INTERVAL_MS: inheritedEnv["LIVE_UPDATE_POLL_INTERVAL_MS"] ?? "100",
};
const backendFeatureEnv = {
  VITE_BACKEND_API_URL: backendApiUrl,
  VITE_FEATURE_USE_BACKEND_BUILDER: "true",
  VITE_FEATURE_USE_BACKEND_SCHEDULING: "true",
  VITE_FEATURE_USE_BACKEND_DELIVERY: "true",
  VITE_FEATURE_USE_BACKEND_PROCTORING: "true",
  VITE_FEATURE_USE_BACKEND_GRADING: "true",
};

export default defineConfig({
  testDir: "./e2e",
  // Vitest keeps one helper unit suite under e2e/ for the production runner.
  // Playwright's default matcher also discovers *.test.ts, which imports
  // Vitest's matcher globals and prevents the browser suite from loading.
  testMatch: "**/*.spec.ts",
  // Production-load and production-smoke suites target an external deployment
  // and have dedicated configs/credentials; generated design-system files are
  // scratch audits, not product regression tests. The default CI suite is
  // Go-backed local integration coverage.
  testIgnore: ["**/prod-load/**", "**/prod-smoke/**", "**/.generated/**"],
  fullyParallel: false,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 2 : 0,
  reporter: "html",
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: frontendUrl,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"] },
    },
    {
      name: "mobile-webkit",
      use: { ...devices["iPhone 13"] },
    },
    {
      name: "tablet-portrait",
      use: { ...devices["iPad (gen 7)"] },
    },
    {
      name: "tablet-landscape",
      use: {
        ...devices["iPad (gen 7)"],
        viewport: { width: 1080, height: 810 },
      },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
  ],
  webServer: [
    {
      command: "bun run coedit:service",
      env: backendRuntimeEnv,
      url: "http://localhost:1235/healthz",
      timeout: 120_000,
      reuseExistingServer: !process.env["CI"],
    },
    {
      command: "cd backend/go && exec go run ./cmd/api",
      env: backendRuntimeEnv,
      url: `${backendApiUrl}/healthz`,
      timeout: 180_000,
      reuseExistingServer: !process.env["CI"],
    },
    {
      command: "cd backend/go && exec go run ./cmd/worker",
      env: backendRuntimeEnv,
      wait: { stderr: /worker: starting job set=/ },
      stderr: "pipe",
      stdout: "pipe",
      timeout: 180_000,
      reuseExistingServer: false,
    },
    {
      command: `bunx vite --port=${frontendPort} --host=0.0.0.0`,
      env: {
        ...process.env,
        ...backendFeatureEnv,
      },
      url: frontendUrl,
      timeout: 120_000,
      reuseExistingServer: !process.env["CI"],
    },
  ],
  workers: 1,
});
