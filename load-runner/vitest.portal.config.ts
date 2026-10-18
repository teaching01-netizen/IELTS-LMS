import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export default defineConfig({
  root: repoRoot,
  test: {
    environment: 'node',
    include: ['load-runner/portal/**/__tests__/**/*.test.ts'],
    exclude: ['**/node_modules/**', 'dist/**', 'load-runner/portal-web/**'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      include: ['load-runner/portal/**/*.ts'],
      exclude: ['load-runner/portal/**/__tests__/**'],
    },
  },
});
