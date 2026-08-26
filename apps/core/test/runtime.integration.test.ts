import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:net';
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

test('runtime exposes distinct loopback listeners', async () => {
  const d = mkdtempSync(path.join(os.tmpdir(), 'aevra-core-'));
  const c = {
    ...loadCoreConfig({
      AEVRA_STATE_DIR: d,
      AEVRA_USERNAME: 'admin',
      AEVRA_PASSWORD: 'secret',
    }),
    publicPort: 0,
    adminPort: 0,
    mcpPort: 0,
  };
  const r = await createCoreRuntime(c, {
    worker: workerStub(),
    ensureTls: (config) => ensureLocalTls(config.stateDir, { trust: false }),
  });

  await r.start();
  try {
    assert.match(r.adminUrl, /^https:\/\/localhost:/);
    assert.match(r.mcpUrl, /^https:\/\/localhost:/);
    assert.match(r.gatewayUrl, /^https:\/\/127\.0\.0\.1:/);
    assert.notEqual(r.adminUrl, r.mcpUrl);
    assert.notEqual(r.gatewayUrl, r.adminUrl);
    assert.notEqual(r.gatewayUrl, r.mcpUrl);
  } finally {
    await r.close();
  }
});

test('runtime starts configured managed Cloudflare through the provider-neutral adapter', async () => {
  const d = mkdtempSync(path.join(os.tmpdir(), 'aevra-core-tunnel-'));
  const c = {
    ...loadCoreConfig({
      AEVRA_STATE_DIR: d,
      AEVRA_USERNAME: 'admin',
      AEVRA_PASSWORD: 'secret',
    }),
    publicPort: 0,
    adminPort: 0,
    mcpPort: 0,
  };
  const db = AevraDatabase.open(c.databasePath);
  new SettingsRepository(db.raw()).set('cloudflare.config', {
    authMode: 'connector',
    hostname: 'mcp.example.com',
    tunnelId: 'tid',
    ownership: 'managed',
  });
  db.close();

  let starts = 0;
  let stops = 0;
  let origin = '';
  const cloudflare: any = {
    async start(localGatewayUrl: string) {
      starts++;
      origin = localGatewayUrl;
      return { publicUrl: 'https://mcp.example.com' };
    },
    async stop() {
      stops++;
    },
    async status() {
      return { state: 'ready' };
    },
    detectCloudflared: async () => ({ found: true }),
    authenticationStatus: async () => ({ authenticated: true, message: 'ok' }),
    authenticate: async () => ({ code: 0, stdout: '', stderr: '' }),
    setup: async () => {
      throw new Error('unused');
    },
    ownership: () => 'managed',
    startManagedTunnel: async () => {},
    stopManagedTunnel: async () => {},
    checkReachability: async () => ({ reachable: false, message: 'offline' }),
  };

  const r = await createCoreRuntime(c, {
    worker: workerStub(),
    cloudflare,
    ensureTls: (config) => ensureLocalTls(config.stateDir, { trust: false }),
  });
  await r.start();
  try {
    assert.equal(starts, 1);
    assert.equal(origin, r.gatewayUrl);
    assert.equal(r.publicUrl, 'https://mcp.example.com');
  } finally {
    await r.close();
  }
  assert.equal(stops, 1);
});

test('runtime starts and closes keep-awake service from persisted policy', async () => {
  const d = mkdtempSync(path.join(os.tmpdir(), 'aevra-core-keep-awake-'));
  const c = {
    ...loadCoreConfig({
      AEVRA_STATE_DIR: d,
      AEVRA_USERNAME: 'admin',
      AEVRA_PASSWORD: 'secret',
    }),
    publicPort: 0,
    adminPort: 0,
    mcpPort: 0,
  };
  const db = AevraDatabase.open(c.databasePath);
  new SettingsRepository(db.raw()).set('power.keepAwake', { mode: 'always' });
  db.close();

  let acquireCalls = 0;
  let releaseCalls = 0;
  const sleepInhibitor = {
    async acquire() {
      acquireCalls++;
    },
    async release() {
      releaseCalls++;
    },
    supported: () => true,
    message: () => undefined,
  };
  const r = await createCoreRuntime(c, {
    worker: workerStub(),
    sleepInhibitor,
    ensureTls: (config) => ensureLocalTls(config.stateDir, { trust: false }),
  });

  await r.start();
  assert.equal(acquireCalls, 1);
  await r.close();
  assert.ok(releaseCalls >= 1);
});
test('runtime cleans partially started worker when public gateway startup fails', async () => {
  const d = mkdtempSync(path.join(os.tmpdir(), 'aevra-core-start-fail-'));
  const blocker = createServer();
  await new Promise<void>((resolve, reject) => {
    blocker.once('error', reject);
    blocker.listen(0, '127.0.0.1', resolve);
  });
  const address = blocker.address();
  assert.ok(address && typeof address !== 'string');

  const c = {
    ...loadCoreConfig({
      AEVRA_STATE_DIR: d,
      AEVRA_USERNAME: 'admin',
      AEVRA_PASSWORD: 'secret',
    }),
    publicPort: address.port,
    adminPort: 0,
    mcpPort: 0,
  };
  let workerStarts = 0;
  let workerCloses = 0;
  const worker = {
    async start() {
      workerStarts++;
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
    async close() {
      workerCloses++;
    },
  };
  const r = await createCoreRuntime(c, {
    worker,
    ensureTls: (config) => ensureLocalTls(config.stateDir, { trust: false }),
  });
  try {
    await assert.rejects(r.start(), /EADDRINUSE/);
    assert.equal(workerStarts, 1);
    assert.equal(workerCloses, 1);
  } finally {
    await r.close();
    await new Promise<void>((resolve) => blocker.close(() => resolve()));
  }
});
