import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { AevraDatabase } from '../../../packages/store/src/database.js';
import { SettingsRepository } from '../../../packages/store/src/settings.js';
import { loadCoreConfig } from '../src/config.js';
import { createCoreRuntime } from '../src/runtime.js';
import { ensureLocalTls } from '../src/tls/local-tls.js';

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

test('verified loopback HTTP gateway can establish an Admin browser session', async () => {
  const stateDir = mkdtempSync(path.join(os.tmpdir(), 'aevra-http-admin-auth-'));
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
    const login = await fetch(`${runtime.gatewayUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: runtime.gatewayUrl,
      },
      body: JSON.stringify({ username: 'admin', password: 'secret' }),
    });

    assert.equal(login.status, 200);
    const setCookie = login.headers.get('set-cookie') ?? '';
    assert.match(setCookie, /aevra_admin=/i);
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Strict/i);
    assert.doesNotMatch(setCookie, /(?:^|;\s*)Secure(?:;|$)/i);

    const cookie = setCookie.split(';')[0] ?? '';
    const session = await fetch(`${runtime.gatewayUrl}/api/auth/session`, {
      headers: { cookie },
    });
    assert.equal(session.status, 200);
    assert.deepEqual(await session.json(), { authenticated: true });

    const dashboard = await fetch(`${runtime.gatewayUrl}/api/dashboard/runtime`, {
      headers: { cookie },
    });
    assert.equal(dashboard.status, 200);
    const snapshot = (await dashboard.json()) as any;
    assert.equal(snapshot.transport.state, 'local-http');
    assert.deepEqual(snapshot.transport.issues, []);
  } finally {
    await runtime.close();
    rmSync(stateDir, { recursive: true, force: true });
  }
});
