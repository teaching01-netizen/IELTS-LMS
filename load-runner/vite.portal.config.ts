import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export default defineConfig({
  root: path.join(repoRoot, 'load-runner', 'web'),
  plugins: [react()],
  base: '/',
  build: {
    outDir: path.join(repoRoot, 'load-runner', 'portal-web'),
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    port: 5174,
    strictPort: false,
    proxy: {
      '/api': {
        target: process.env['PORTAL_DEV_API_TARGET'] ?? 'http://127.0.0.1:3366',
        changeOrigin: true,
      },
    },
  },
});
