import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@aevra/admin-contracts': fileURLToPath(
        new URL('./packages/admin-contracts/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'jsdom',
    include: [
      'apps/web/test/**/*.test.js',
      'apps/web-react/src/**/*.test.ts',
      'apps/web-react/src/**/*.test.tsx',
    ],
    setupFiles: ['apps/web-react/src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      include: [
        'apps/web/**/*.js',
        'apps/web-react/src/**/*.ts',
        'apps/web-react/src/**/*.tsx',
      ],
      exclude: [
        'apps/web/test/**',
        'apps/web-react/src/**/*.test.ts',
        'apps/web-react/src/**/*.test.tsx',
        'apps/web-react/src/test/**',
      ],
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
