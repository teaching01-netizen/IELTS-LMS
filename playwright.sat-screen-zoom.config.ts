import { defineConfig, devices } from '@playwright/test';
import baseConfig from './playwright.config';

export default defineConfig({
  ...baseConfig,
  testMatch: 'sat-screen-zoom.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 240_000,
  retries: 0,
  reporter: 'list',
  projects: [
    { name: 'touch-chromium', use: { ...devices['Pixel 7'] } },
    {
      name: 'webkit-ipad',
      use: { ...devices['iPad (gen 7) landscape'], browserName: 'webkit' },
    },
  ],
});
