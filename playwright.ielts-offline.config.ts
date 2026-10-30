import { defineConfig, devices } from '@playwright/test';

// Production-preview profile for the shared IELTS timetable offline suite.
// A service worker can only control a real navigation on a built origin, so
// this config builds the bundle, serves it with `vite preview`, and runs the
// Go API/worker against an explicitly isolated, fully migrated test database.
const databaseUrl = process.env['TEST_DATABASE_URL'];
if (!databaseUrl) throw new Error('TEST_DATABASE_URL must point to an isolated database for IELTS offline tests.');
const frontendPort = process.env['PLAYWRIGHT_FRONTEND_PORT'] ?? '3321';
const backendPort = process.env['PLAYWRIGHT_BACKEND_PORT'] ?? '4321';
const origin = `http://127.0.0.1:${frontendPort}`;
const backend = `http://127.0.0.1:${backendPort}`;
const env: Record<string, string> = {
  DATABASE_URL: databaseUrl, DATABASE_DIRECT_URL: databaseUrl, DATABASE_MIGRATOR_URL: databaseUrl,
  DATABASE_WORKER_URL: databaseUrl, TEST_DATABASE_URL: databaseUrl,
  APP_ENV: 'test', ENVIRONMENT: 'test',
  AUTH_SECRET: 'isolated-ielts-offline-test-secret-32-characters',
  AUTH_PUBLIC_ORIGIN: origin, COOKIE_SECURE: 'false',
  SESSION_COOKIE_NAME: 'session', CSRF_COOKIE_NAME: 'csrf', SESSION_CACHE: 'off',
  SESSION_IDLE_STAFF_MINS: '30', SESSION_IDLE_STUDENT_MINS: '60', SESSION_ABSOLUTE_HOURS: '12',
  ATTEMPT_TOKEN_TTL_MINUTES: '15', EXAM_ACCESS_ENABLED: 'true', EXAM_ACCESS_MAX_HOURS: '12',
  BACKGROUND_RUNTIME_MODE: 'continuous', PORT: backendPort, API_PORT: backendPort,
  WORKER_MAINTENANCE_INTERVAL_SECS: '30', WORKER_FALLBACK_INTERVAL_SECS: '1',
  IELTS_SHARED_SCHEDULE: 'true',
  VITE_BACKEND_API_URL: backend,
  VITE_FEATURE_USE_BACKEND_BUILDER: 'true', VITE_FEATURE_USE_BACKEND_SCHEDULING: 'true',
  VITE_FEATURE_USE_BACKEND_DELIVERY: 'true', VITE_FEATURE_USE_BACKEND_PROCTORING: 'true',
  VITE_FEATURE_USE_BACKEND_GRADING: 'true', VITE_STUDENT_REALTIME: 'polling',
};
Object.assign(process.env, env);

export default defineConfig({
  testDir: './e2e',
  testMatch: ['ielts-shared-offline.spec.ts'],
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  outputDir: 'test-results/ielts-offline',
  use: { baseURL: origin, trace: 'retain-on-failure', screenshot: 'only-on-failure', serviceWorkers: 'allow' },
  projects: [{ name: 'offline-chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    { command: 'go -C backend/go run ./cmd/migrate && go -C backend/go run ./cmd/api', env, url: `${backend}/healthz`, reuseExistingServer: false, timeout: 180_000 },
    { command: 'go -C backend/go run ./cmd/worker', env, wait: { stderr: /worker: starting job set=/ }, stderr: 'pipe', stdout: 'pipe', reuseExistingServer: false, timeout: 180_000 },
    { command: `bun run build && bunx vite preview --host=127.0.0.1 --port=${frontendPort} --strictPort`, env, url: origin, reuseExistingServer: false, timeout: 240_000 },
  ],
});
