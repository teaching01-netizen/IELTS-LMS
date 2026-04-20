import { defineConfig, devices } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

function loadEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) return;
  dotenv.config({ path: filePath, override: false });
}

// Let local runs rely on `.env` without exporting vars manually.
const workspaceRoot = process.cwd();
loadEnvFile(path.resolve(workspaceRoot, '.env'));
loadEnvFile(path.resolve(workspaceRoot, 'backend', '.env'));
loadEnvFile(path.resolve(workspaceRoot, '.env.example'));

const baseURL =
  process.env['E2E_PROD_BASE_URL'] ?? 'https://ielts-lms-production.up.railway.app';

export default defineConfig({
  testDir: './e2e/prod-smoke',
  fullyParallel: false,
  forbidOnly: !!process.env['CI'],
  retries: 0,
  reporter: process.env['CI'] ? 'list' : 'html',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  workers: 1,
});
