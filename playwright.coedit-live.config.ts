/**
 * LIVE SAT workspace co-editing harness — the design's "Browser and failure
 * tests".
 *
 * The default suite runs against a server someone else started. This config
 * starts its own stack instead, because co-editing spans three processes that
 * only exist together: a Go API built from this working tree, the singleton
 * Hocuspocus service, and a vite dev server with SAT workspace collaboration
 * enabled by product default —
 * all on their own ports and their own database, so a live run never disturbs
 * a running dev server or the developer's data.
 *
 * Staff sessions come from the repository's existing e2e seed convention
 * (`e2e/global-setup.ts` → `e2e/.generated/*.storage-state.json`), not from
 * hand-made cookie files.
 *
 * Run from the repository root:
 *
 *   node_modules/.bin/playwright test -c playwright.coedit-live.config.ts
 *
 * Environment overrides (all optional): COEDIT_LIVE_DATABASE_URL,
 * COEDIT_LIVE_API_PORT, COEDIT_LIVE_SERVICE_PORT, COEDIT_LIVE_WEB_PORT,
 * COEDIT_LIVE_SCRATCH.
 */
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const ROOT = path.dirname(fileURLToPath(import.meta.url));

const API_PORT = Number(process.env["COEDIT_LIVE_API_PORT"] ?? 4100);
const COEDIT_PORT = Number(process.env["COEDIT_LIVE_SERVICE_PORT"] ?? 1235);
const WEB_PORT = Number(process.env["COEDIT_LIVE_WEB_PORT"] ?? 3100);
const SCRATCH = process.env["COEDIT_LIVE_SCRATCH"] ?? path.join(os.tmpdir(), "coedit-live");

const DATABASE_URL =
  process.env["COEDIT_LIVE_DATABASE_URL"] ?? "mysql://root:root@127.0.0.1:3306/ielts_coedit_e2e";
const AUTH_SECRET = "coedit-live-auth-secret-at-least-32-chars-long";
const TOKEN_SECRET = "coedit-live-token-secret-at-least-32-bytes-long";
const SERVICE_SECRET = "coedit-live-service-secret-at-least-32-bytes-long";

const API = `http://127.0.0.1:${API_PORT}`;
const WEB = `http://127.0.0.1:${WEB_PORT}`;
const COEDIT = `http://127.0.0.1:${COEDIT_PORT}`;

// The seed step in e2e/global-setup.ts runs in this process and must write its
// staff sessions (and run its migrations) against the SAME database the API
// below reads, so these are assigned rather than defaulted: an inherited
// DATABASE_URL from another environment would silently seed the wrong one.
process.env["DATABASE_URL"] = DATABASE_URL;
process.env["AUTH_SECRET"] = AUTH_SECRET;
// A PORT inherited from the surrounding shell (0 is common) would make the
// seeding step fail config validation, so the harness pins the port it starts.
process.env["PORT"] = String(API_PORT);
process.env["API_PORT"] = String(API_PORT);
process.env["APP_ENV"] ??= "test";
process.env["ENVIRONMENT"] ??= "test";

// The running spec asserts against the same stack this config starts, so it
// reads the derived values rather than repeating them.
export const LIVE = { ROOT, API, WEB, COEDIT, DATABASE_URL, SERVICE_SECRET };

// Playwright starts web servers BEFORE global setup, and `go run ./cmd/migrate`
// cannot open a database that does not exist yet, so the dedicated database is
// created here rather than in e2e/global-setup.ts. The step is skipped (with a
// pointer to the manual command) where no mysql client is installed.
const DSN = new URL(DATABASE_URL);
const DB_NAME = DSN.pathname.replace(/^\//, "");
const DB_BOOTSTRAP = [
  "command -v mysql >/dev/null 2>&1",
  `mysql -h ${DSN.hostname} -P ${DSN.port || 3306} -u ${decodeURIComponent(DSN.username)}`,
  DSN.password ? `-p${decodeURIComponent(DSN.password)}` : "",
  `-e 'CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4'`,
  "|| echo 'coedit-live: mysql client unavailable; create " + DB_NAME + " manually'",
]
  .filter(Boolean)
  .join(" ");

export default defineConfig({
  testDir: path.join(ROOT, "e2e/coedit-live"),
  testMatch: "**/*.live.ts",
  globalSetup: path.join(ROOT, "e2e/global-setup.ts"),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // Two real browsers, a service round trip and a database flush per stage.
  timeout: 15 * 60_000,
  reporter: [["list"]],
  use: {
    baseURL: WEB,
    ...devices["Desktop Chrome"],
    permissions: ["clipboard-read", "clipboard-write"],
  },
  projects: [{ name: "coedit-live", use: { baseURL: WEB } }],
  webServer: [
    {
      // Built here, not reused: a binary left over from an earlier revision
      // would test code that is not this working tree, which is exactly the
      // failure mode this harness exists to prevent.
      command: `${DB_BOOTSTRAP} && mkdir -p ${SCRATCH} && go build -o ${SCRATCH}/api ./cmd/api && go run ./cmd/migrate && ${SCRATCH}/api`,
      cwd: path.join(ROOT, "backend/go"),
      env: {
        ...process.env,
        DATABASE_URL,
        AUTH_SECRET,
        APP_ENV: "test",
        ENVIRONMENT: "test",
        PORT: String(API_PORT),
        API_PORT: String(API_PORT),
        COOKIE_SECURE: "false",
        SESSION_COOKIE_NAME: "session",
        CSRF_COOKIE_NAME: "csrf",
        MIGRATIONS_DIR: "migrations",
        AUTHORING_REALTIME_EVENTS: "false",
        AUTHORING_REALTIME_DELIVERY: "false",
        AUTHORING_COEDIT_SERVICE_ENABLED: "true",
        AUTHORING_COEDIT_SERVICE_URL: COEDIT,
        AUTHORING_COEDIT_TOKEN_SECRET: TOKEN_SECRET,
        AUTHORING_COEDIT_SERVICE_SECRET: SERVICE_SECRET,
        AUTHORING_COEDIT_PUBLIC_WS_SCHEME: "ws",
      },
      url: `${API}/healthz`,
      // A fresh database means every migration runs before the API answers.
      timeout: 300_000,
      reuseExistingServer: false,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: `${path.join(ROOT, "node_modules/.bin/tsx")} src/main.ts`,
      cwd: path.join(ROOT, "services/authoring-coedit"),
      env: {
        ...process.env,
        AUTHORING_COEDIT_ENVIRONMENT: "e2e",
        AUTHORING_COEDIT_MYSQL_DSN: DATABASE_URL,
        AUTHORING_COEDIT_PORT: String(COEDIT_PORT),
        AUTHORING_COEDIT_HOST: "127.0.0.1",
        AUTHORING_COEDIT_GO_BASE_URL: API,
        AUTHORING_COEDIT_TOKEN_SECRET: TOKEN_SECRET,
        AUTHORING_COEDIT_SERVICE_SECRET: SERVICE_SECRET,
        AUTHORING_COEDIT_ALLOWED_ORIGIN: WEB,
      },
      url: `${COEDIT}/readyz`,
      timeout: 120_000,
      reuseExistingServer: false,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: `${path.join(ROOT, "node_modules/.bin/vite")} --host 127.0.0.1 --port ${WEB_PORT} --strictPort`,
      cwd: ROOT,
      env: {
        ...process.env,
        VITE_BACKEND_API_URL: API,
        // Workspace co-editing is always on in SAT authoring. Keep the older
        // authoring event/delivery rollout OFF here so this test proves the
        // exam-level room is the live path for editor changes.
        VITE_AUTHORING_REALTIME_EVENTS: "false",
        VITE_AUTHORING_REALTIME_DELIVERY: "false",
        VITE_FEATURE_USE_BACKEND_BUILDER: "true",
        VITE_FEATURE_USE_BACKEND_SCHEDULING: "true",
        VITE_FEATURE_USE_BACKEND_DELIVERY: "true",
        VITE_FEATURE_USE_BACKEND_PROCTORING: "true",
        VITE_FEATURE_USE_BACKEND_GRADING: "true",
      },
      url: WEB,
      timeout: 180_000,
      reuseExistingServer: false,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
