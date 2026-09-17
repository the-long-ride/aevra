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
    // The management and settings specs drive whole pages through many
    // mocked requests. They sit near 3s uninstrumented, and v8 coverage
    // roughly doubles that, so vitest's 5s default trips them.
    testTimeout: 20_000,
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
