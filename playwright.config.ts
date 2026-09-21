import { defineConfig } from '@playwright/test';

const externalBaseUrl = process.env.AEVRA_PARITY_BASE_URL;
const localBaseUrl = 'http://127.0.0.1:47839';

export default defineConfig({
  testDir: './tests/ui-parity',
  timeout: 30_000,
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: externalBaseUrl ?? localBaseUrl,
    permissions: ['clipboard-read', 'clipboard-write'],
    trace: 'retain-on-failure',
  },
  webServer: externalBaseUrl
    ? undefined
    : {
        command: 'node tests/ui-parity/static-server.mjs',
        url: localBaseUrl,
        reuseExistingServer: false,
        timeout: 15_000,
      },
});
