import type { PlaywrightTestConfig } from '@playwright/test';
import baseConfig from './playwright.config';

if (!process.env['TEST_DATABASE_URL']?.trim()) throw new Error('SAT code-start E2E requires an isolated TEST_DATABASE_URL.');
if (process.env['SAT_ACCESS_CODE_START'] !== 'true' || !process.env['SAT_START_CODE_KEYS']?.trim()) throw new Error('SAT code-start E2E requires creation enabled and a dedicated test keyring.');

export default {
  ...baseConfig,
  testMatch: '**/sat-access-code-start.spec.ts',
  projects: (baseConfig.projects ?? []).filter(project => project.name === 'chromium'),
} satisfies PlaywrightTestConfig;
