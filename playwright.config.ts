import { defineConfig, devices } from "@playwright/test";

const backendApiUrl = process.env["VITE_BACKEND_API_URL"] ?? "http://localhost:4001";
const e2eDatabaseUrl = process.env["E2E_DATABASE_URL"] ?? "mysql://root@127.0.0.1:4000/ielts";
const backendCookieEnv = {
  AUTH_COOKIE_SECURE: "false",
  AUTH_SESSION_COOKIE_NAME: "session",
  AUTH_CSRF_COOKIE_NAME: "csrf",
  AUTH_SECRET: process.env["E2E_AUTH_SECRET"] ?? "e2e-local-auth-secret",
  MASTER_KEY_ENABLED: "false",
};
const backendE2eEnv = {
  API_HOST: "0.0.0.0",
  API_PORT: "4001",
  DATABASE_URL: e2eDatabaseUrl,
  DATABASE_DIRECT_URL: e2eDatabaseUrl,
  DATABASE_MIGRATOR_URL: e2eDatabaseUrl,
  DATABASE_WORKER_URL: e2eDatabaseUrl,
  OBJECT_STORAGE_BACKEND: "minio",
  OBJECT_STORAGE_ENDPOINT: "http://127.0.0.1:9000",
  OBJECT_STORAGE_BUCKET: "ielts-media",
  OBJECT_STORAGE_ACCESS_KEY: "minioadmin",
  OBJECT_STORAGE_SECRET_KEY: "minioadmin",
  OBJECT_STORAGE_FORCE_PATH_STYLE: "true",
};
const backendFeatureEnv = {
  VITE_BACKEND_API_URL: backendApiUrl,
  VITE_FEATURE_USE_BACKEND_BUILDER: "true",
  VITE_FEATURE_USE_BACKEND_SCHEDULING: "true",
  VITE_FEATURE_USE_BACKEND_DELIVERY: "true",
};

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 2 : 0,
  reporter: "html",
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: "http://localhost:3000",
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
      command:
        "cd backend && cargo build -p ielts-backend-api && exec ./target/debug/ielts-backend-api",
      env: {
        ...process.env,
        ...backendCookieEnv,
        ...backendE2eEnv,
      },
      url: "http://localhost:4001/healthz",
      timeout: 180_000,
      reuseExistingServer: !process.env["CI"],
    },
    {
      command: "npm run dev",
      env: {
        ...process.env,
        ...backendFeatureEnv,
      },
      url: "http://localhost:3000",
      timeout: 120_000,
      reuseExistingServer: !process.env["CI"],
    },
  ],
  workers: 1,
});
