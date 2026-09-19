import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e', testMatch: 'student-owned-touch-selection.spec.ts',
  reporter: 'list', workers: 1, retries: 0,
  use: { baseURL: 'http://127.0.0.1:3100', trace: 'retain-on-failure' },
  projects: [
    { name: 'touch-chromium', use: { ...devices['Pixel 7'] } },
    { name: 'ipad-webkit', use: { ...devices['iPad (gen 7)'] } },
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: { command: 'bun run dev -- --host 127.0.0.1 --port 3100', url: 'http://127.0.0.1:3100', reuseExistingServer: true },
});
