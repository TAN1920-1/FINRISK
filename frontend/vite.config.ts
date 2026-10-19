/// <reference types="vitest" />
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

/**
 * The API origin is never hard-coded in application code.  In development the
 * dev server proxies `/api` to the FastAPI backend so the browser talks to a
 * single origin; in a deployment `VITE_API_BASE_URL` points at the API.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const devApiTarget = env.VITE_DEV_API_TARGET || 'http://127.0.0.1:8000';

  return {
    plugins: [react()],
    root: '.',
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      sourcemap: false,
    },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        '/api': {
          target: devApiTarget,
          changeOrigin: true,
        },
      },
    },
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: ['./vitest.setup.ts'],
      include: ['src/**/*.{test,spec}.{ts,tsx}'],
      css: false,
      restoreMocks: true,
    },
  };
});
