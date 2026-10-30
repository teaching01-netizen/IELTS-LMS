import { defineConfig, devices } from '@playwright/test';

// This profile seeds fixture rows. Require an explicit isolated test DB rather
// than inheriting a developer/production DATABASE_URL from dotenv files.
const databaseUrl = process.env['TEST_DATABASE_URL'];
if (!databaseUrl) throw new Error('TEST_DATABASE_URL must point to an isolated database for exam-continuity tests.');
const frontendPort = process.env['PLAYWRIGHT_FRONTEND_PORT'] ?? '3319';
const backendPort = process.env['PLAYWRIGHT_BACKEND_PORT'] ?? '4319';
const origin = `http://127.0.0.1:${frontendPort}`;
const backend = `http://127.0.0.1:${backendPort}`;
const env: Record<string, string> = {
  DATABASE_URL: databaseUrl, DATABASE_DIRECT_URL: databaseUrl, DATABASE_MIGRATOR_URL: databaseUrl,
  DATABASE_WORKER_URL: databaseUrl, TEST_DATABASE_URL: databaseUrl,
  APP_ENV: 'test', ENVIRONMENT: 'test',
  AUTH_SECRET: 'isolated-exam-continuity-test-secret-32-characters',
  AUTH_PUBLIC_ORIGIN: origin, COOKIE_SECURE: 'false',
  SESSION_COOKIE_NAME: 'session', CSRF_COOKIE_NAME: 'csrf', SESSION_CACHE: 'off',
  SESSION_IDLE_STAFF_MINS: '30', SESSION_IDLE_STUDENT_MINS: '60', SESSION_ABSOLUTE_HOURS: '12',
  ATTEMPT_TOKEN_TTL_MINUTES: '15', EXAM_ACCESS_ENABLED: 'true', EXAM_ACCESS_MAX_HOURS: '12',
  BACKGROUND_RUNTIME_MODE: 'continuous', PORT: backendPort, API_PORT: backendPort,
  WORKER_MAINTENANCE_INTERVAL_SECS: '30', WORKER_FALLBACK_INTERVAL_SECS: '1',
  VITE_BACKEND_API_URL: backend,
  VITE_FEATURE_USE_BACKEND_BUILDER: 'true', VITE_FEATURE_USE_BACKEND_SCHEDULING: 'true',
  VITE_FEATURE_USE_BACKEND_DELIVERY: 'true', VITE_FEATURE_USE_BACKEND_PROCTORING: 'true',
  VITE_FEATURE_USE_BACKEND_GRADING: 'true', VITE_STUDENT_REALTIME: 'polling',
};
Object.assign(process.env, env);

export default defineConfig({
  testDir: './e2e', testMatch: ['student-auth-lifetime.spec.ts', 'exam-continuity.spec.ts'],
  globalSetup: './e2e/global-setup.ts', fullyParallel: false, workers: 1,
  reporter: 'list', outputDir: 'test-results/exam-continuity',
  use: { baseURL: origin, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'continuity-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'continuity-tablet', use: { ...devices['iPad (gen 7)'] } }],
  webServer: [
    { command: 'go -C backend/go run ./cmd/migrate && go -C backend/go run ./cmd/api', env, url: `${backend}/healthz`, reuseExistingServer: false, timeout: 180_000 },
    { command: 'go -C backend/go run ./cmd/worker', env, wait: { stderr: /worker: starting job set=/ }, stderr: 'pipe', stdout: 'pipe', reuseExistingServer: false, timeout: 180_000 },
    { command: `bunx vite --host=127.0.0.1 --port=${frontendPort} --strictPort`, env, url: origin, reuseExistingServer: false, timeout: 120_000 },
  ],
});
