import { defineConfig } from 'vitest/config';

// The extension is the one place with real DOM and chrome.* code, so it gets
// its own jsdom project rather than joining the Node suites, which compile
// under `types: []` with no DOM lib.
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // Only genuinely non-shipping files are excluded: the tests themselves and
      // this config. Every other file under src/ runs in the browser and counts.
      exclude: ['src/**/*.test.ts', 'vitest.config.ts'],
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
