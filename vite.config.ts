import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  const backendApiUrl = env['VITE_BACKEND_API_URL'] || 'http://127.0.0.1:4000';
  return {
    plugins: [
      react(), 
      tailwindcss(),
    ],
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
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env['DISABLE_HMR'] !== 'true',
      proxy: {
        '/api': {
          target: backendApiUrl,
          // Keep the browser-visible Host for backend same-origin CSRF validation.
          // Rewriting it to the proxy target makes frontend mutations fail origin checks.
          changeOrigin: false,
          ws: true,
        },
        '/v2': {
          target: backendApiUrl,
          changeOrigin: false,
        },
      },
    },
    build: {
      // Emits dist/.vite/manifest.json for the student provider bundle
      // isolation gate (`bun run test:student-bundle`). Tiny JSON artifact;
      // the bundle-size analysis reads dist/index.html and is unaffected.
      manifest: true,
      rollupOptions: {
        output: {},
      },
      chunkSizeWarningLimit: 1000,
    },
  };
});
