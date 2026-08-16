import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/',
  publicDir: '../../assets',
  plugins: [react()],
  resolve: {
    alias: {
      '@aevra/admin-contracts': fileURLToPath(
        new URL('../../packages/admin-contracts/src/index.ts', import.meta.url),
      ),
    },
  },
  build: {
    outDir: '../../dist/apps/web',
    emptyOutDir: true,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      thresholds: {
        lines: 85,
        statements: 85,
        functions: 85,
        branches: 85,
      },
      reporter: ['text', 'json-summary'],
    },
  },
});
