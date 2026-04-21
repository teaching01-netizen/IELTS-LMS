import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';

function loadEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) return;
  dotenv.config({ path: filePath, override: false });
}

// Allow "just change it at .env" workflows (local + CI secret mounts).
// This does not override already-exported env vars.
const workspaceRoot = process.cwd();
loadEnvFile(path.resolve(workspaceRoot, '.env'));
loadEnvFile(path.resolve(workspaceRoot, 'backend', '.env'));
loadEnvFile(path.resolve(workspaceRoot, '.env.example'));

function resolveTargetPath(): string {
  const override = process.env['E2E_PROD_TARGET_PATH'];
  if (override) return path.resolve(process.cwd(), override);
  return path.resolve(process.cwd(), 'e2e/prod-data/prod-target.json');
}

function readBaseURL(): string {
  const envBaseUrl = process.env['E2E_PROD_BASE_URL'];
  if (envBaseUrl) return envBaseUrl;

  const targetPath = resolveTargetPath();
  const raw = fs.readFileSync(targetPath, 'utf8');
  const json = JSON.parse(raw) as { baseURL?: unknown };
  const baseURL = typeof json.baseURL === 'string' ? json.baseURL : '';
  if (!baseURL) {
    throw new Error(`baseURL missing in ${targetPath}. Set E2E_PROD_BASE_URL to override.`);
  }
  return baseURL;
}

const baseURL = readBaseURL();
const testTimeoutMinutes = Number(process.env['E2E_PROD_TEST_TIMEOUT_MINUTES'] ?? '45');
const testTimeoutMs = Math.max(5, testTimeoutMinutes) * 60 * 1000;
const shardIndex = Number(process.env['E2E_PROD_SHARD_INDEX'] ?? '0');
const shardCount = Number(process.env['E2E_PROD_SHARD_COUNT'] ?? '1');
const runId = process.env['E2E_PROD_RUN_ID'] ?? 'prod-load';

// Default to minimal artifacts for long-running prod runs; enable as needed.
const traceMode = (process.env['E2E_PROD_TRACE'] ?? 'off') as 'off' | 'on' | 'retain-on-failure' | 'on-first-retry';
const videoMode = (process.env['E2E_PROD_VIDEO'] ?? 'off') as 'off' | 'on' | 'retain-on-failure' | 'on-first-retry';
const screenshotMode = (process.env['E2E_PROD_SCREENSHOT'] ?? 'only-on-failure') as
  | 'off'
  | 'on'
  | 'only-on-failure';

export default defineConfig({
  testDir: './e2e/prod-load',
  fullyParallel: false,
  forbidOnly: !!process.env['CI'],
  retries: 0,
  reporter: process.env['CI']
    ? 'list'
    : [['html', { outputFolder: `playwright-report/prod-load-${runId}-shard-${shardIndex}-of-${shardCount}`, open: 'never' }]],
  outputDir: `test-results/prod-load-${runId}-shard-${shardIndex}-of-${shardCount}`,
  timeout: testTimeoutMs,
  expect: {
    timeout: 30_000,
  },
  use: {
    baseURL,
    trace: traceMode,
    screenshot: screenshotMode,
    video: videoMode,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: [
            '--use-fake-device-for-media-stream',
            '--use-fake-ui-for-media-stream',
            '--auto-select-desktop-capture-source=Entire screen',
          ],
        },
      },
    },
  ],
  workers: Number(process.env['E2E_PROD_WORKERS'] ?? '1'),
});
