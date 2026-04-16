import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      '@app': path.resolve(__dirname, './src/app'),
      '@components': path.resolve(__dirname, './src/components'),
      '@services': path.resolve(__dirname, './src/services'),
      '@admin': path.resolve(__dirname, './src/features/admin'),
      '@builder': path.resolve(__dirname, './src/features/builder'),
      '@proctor': path.resolve(__dirname, './src/features/proctor'),
      '@student': path.resolve(__dirname, './src/features/student'),
      '@shared': path.resolve(__dirname, './src/shared'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    exclude: ['node_modules', 'dist', 'e2e'],
  },
});
