import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: ['ielts-case-sensitive-note.spec.ts', 'ielts-student-to-pdf-flow.spec.ts', 'ielts-question-type-matrices.spec.ts'],
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  projects: [{ name: 'logic' }],
  // No webServer, no globalSetup, no DATABASE_URL: pure vertical-slice
  // parity through real grading functions (no mocks).
});
