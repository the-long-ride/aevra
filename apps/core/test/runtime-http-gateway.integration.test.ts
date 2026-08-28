import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadCoreConfig } from '../src/config.js';
import { createCoreRuntime } from '../src/runtime.js';
import { ensureLocalTls } from '../src/tls/local-tls.js';
import { AevraDatabase } from '../../../packages/store/src/database.js';
import { SettingsRepository } from '../../../packages/store/src/settings.js';

function workerStub() {
  return {
    async start() {
      return {
        async execute() {
          return { ok: false, error: { code: 'EXECUTOR_UNAVAILABLE', message: 'x' } } as any;
        },
        async health() {
          return { ready: true, pid: 1 };
        },
        async close() {},
      };
    },
    async close() {},
  };
}

test('HTTP local transport changes only the gateway while Admin and MCP stay HTTPS', async () => {
  const stateDir = mkdtempSync(path.join(os.tmpdir(), 'aevra-http-gateway-'));
  const config = {
    ...loadCoreConfig({
      AEVRA_STATE_DIR: stateDir,
      AEVRA_USERNAME: 'admin',
      AEVRA_PASSWORD: 'secret',
    }),
    publicPort: 0,
    adminPort: 0,
    mcpPort: 0,
  };

  const database = AevraDatabase.open(config.databasePath);
  new SettingsRepository(database.raw()).set('exposure.config', {
    provider: 'local',
    localProtocol: 'http',
  });
  database.close();

  const runtime = await createCoreRuntime(config, {
    worker: workerStub(),
    ensureTls: (current) => ensureLocalTls(current.stateDir, { trust: false }),
  });

  await runtime.start();
  try {
    assert.match(runtime.gatewayUrl, /^http:\/\/127\.0\.0\.1:/);
    assert.match(runtime.adminUrl, /^https:\/\/localhost:/);
    assert.match(runtime.mcpUrl, /^https:\/\/localhost:/);
  } finally {
    await runtime.close();
  }
});
