import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import dotenv from "dotenv";

// Playwright loads its web-server environment before globalSetup runs. Load
// the same local/CI defaults here so the Go API receives a complete config.
dotenv.config({ path: path.resolve(".env"), override: false });
dotenv.config({ path: path.resolve("backend/.env"), override: false });
dotenv.config({ path: path.resolve("backend/.env.example"), override: false });

const backendApiUrl = process.env["VITE_BACKEND_API_URL"] ?? "http://localhost:4000";
const backendCookieEnv = {
  COOKIE_SECURE: process.env["COOKIE_SECURE"] ?? "false",
  SESSION_COOKIE_NAME: process.env["SESSION_COOKIE_NAME"] ?? "session",
  CSRF_COOKIE_NAME: process.env["CSRF_COOKIE_NAME"] ?? "csrf",
};
const backendRuntimeEnv = {
  ...process.env,
  ...backendCookieEnv,
  PORT: process.env["PORT"] ?? "4000",
  API_PORT: process.env["API_PORT"] ?? "4000",
  APP_ENV: process.env["APP_ENV"] ?? "test",
  ENVIRONMENT: process.env["ENVIRONMENT"] ?? "test",
  MIGRATIONS_DIR: process.env["MIGRATIONS_DIR"] ?? "migrations",
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
    baseURL: "http://localhost:33000",
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
      command: "cd backend/go && exec go run ./cmd/api",
      env: backendRuntimeEnv,
      url: "http://localhost:44000/healthz",
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
      command: "bun run dev -- --port=33000",
      env: {
        ...process.env,
        ...backendFeatureEnv,
      },
      url: "http://localhost:33000",
      timeout: 120_000,
      reuseExistingServer: !process.env["CI"],
    },
  ],
  workers: 1,
});
