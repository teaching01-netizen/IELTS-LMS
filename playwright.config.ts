import { defineConfig, devices } from '@playwright/test';

const backendApiUrl = process.env['VITE_BACKEND_API_URL'] ?? 'http://localhost:4000';
const backendCookieEnv = {
  AUTH_COOKIE_SECURE: process.env['AUTH_COOKIE_SECURE'] ?? 'false',
  AUTH_SESSION_COOKIE_NAME: process.env['AUTH_SESSION_COOKIE_NAME'] ?? 'session',
  AUTH_CSRF_COOKIE_NAME: process.env['AUTH_CSRF_COOKIE_NAME'] ?? 'csrf',
};
const backendFeatureEnv = {
  VITE_BACKEND_API_URL: backendApiUrl,
  VITE_FEATURE_USE_BACKEND_BUILDER: 'true',
  VITE_FEATURE_USE_BACKEND_SCHEDULING: 'true',
  VITE_FEATURE_USE_BACKEND_DELIVERY: 'true',
};

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  reporter: 'html',
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],
  webServer: [
    {
      command:
        'cd backend && set -a && . ./.env && set +a && cargo build -p ielts-backend-api && exec ./target/debug/ielts-backend-api',
      env: {
        ...process.env,
        ...backendCookieEnv,
      },
      url: 'http://localhost:4000/healthz',
      reuseExistingServer: !process.env['CI'],
    },
    {
      command: 'npm run dev',
      env: {
        ...process.env,
        ...backendFeatureEnv,
      },
      url: 'http://localhost:3000',
      reuseExistingServer: !process.env['CI'],
    },
  ],
  workers: 1,
});
