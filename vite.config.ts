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
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env['GEMINI_API_KEY']),
    },
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
          changeOrigin: true,
          ws: true,
        },
      },
    },
    build: {
      rollupOptions: {
        output: {},
      },
      chunkSizeWarningLimit: 1000,
    },
  };
});
