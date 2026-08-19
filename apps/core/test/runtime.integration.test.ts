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

test('runtime exposes distinct loopback listeners', async () => {
  const d = mkdtempSync(path.join(os.tmpdir(), 'aevra-core-'));
  const c = { ...loadCoreConfig({ AEVRA_STATE_DIR: d }), adminPort: 0, mcpPort: 0 };
  const fake = {
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
  const r = await createCoreRuntime(c, {
    worker: fake,
    ensureTls: (config) => ensureLocalTls(config.stateDir, { trust: false }),
  });

  await r.start();
  try {
    assert.match(r.adminUrl, /^https:\/\/localhost:/);
    assert.match(r.mcpUrl, /^https:\/\/localhost:/);
    assert.notEqual(r.adminUrl, r.mcpUrl);
  } finally {
    await r.close();
  }
});

test('runtime starts a configured managed Cloudflare tunnel', async () => {
  const d = mkdtempSync(path.join(os.tmpdir(), 'aevra-core-tunnel-'));
  const c = { ...loadCoreConfig({ AEVRA_STATE_DIR: d }), adminPort: 0, mcpPort: 0 };
  const db = AevraDatabase.open(c.databasePath);
  new SettingsRepository(db.raw()).set('cloudflare.config', {
    authMode: 'connector',
    hostname: 'mcp.example.com',
    tunnelId: 'tid',
    ownership: 'managed',
  });
  db.close();
  let starts = 0,
    stops = 0;
  const cloudflare: any = {
    detectCloudflared: async () => ({ found: true }),
    authenticate: async () => ({ code: 0, stdout: '', stderr: '' }),
    setup: async () => {
      throw new Error('unused');
    },
    ownership: () => 'managed',
    startManagedTunnel: async () => {
      starts++;
    },
    stopManagedTunnel: async () => {
      stops++;
    },
    checkReachability: async () => ({ reachable: false, message: 'offline' }),
  };
  const worker = {
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
  const r = await createCoreRuntime(c, {
    worker,
    cloudflare,
    ensureTls: (config) => ensureLocalTls(config.stateDir, { trust: false }),
  } as any);
  await r.start();
  assert.equal(starts, 1);
  await r.close();
  assert.equal(stops, 1);
});

test('runtime cleans partially started worker when later startup fails', async () => {
  const d = mkdtempSync(path.join(os.tmpdir(), 'aevra-core-start-fail-'));
  const c = { ...loadCoreConfig({ AEVRA_STATE_DIR: d }), adminPort: 0, mcpPort: 0 };
  const db = AevraDatabase.open(c.databasePath);
  new SettingsRepository(db.raw()).set('cloudflare.config', {
    authMode: 'connector',
    hostname: 'mcp.example.com',
    tunnelId: 'tid',
    ownership: 'managed',
  });
  db.close();
  let workerStarts = 0,
    workerCloses = 0,
    tunnelStops = 0;
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
  const cloudflare: any = {
    detectCloudflared: async () => ({ found: true }),
    authenticate: async () => ({ code: 0, stdout: '', stderr: '' }),
    setup: async () => {
      throw new Error('unused');
    },
    ownership: () => 'managed',
    startManagedTunnel: async () => {
      throw new Error('tunnel-start-boom');
    },
    stopManagedTunnel: async () => {
      tunnelStops++;
    },
    checkReachability: async () => ({ reachable: false, message: 'offline' }),
  };
  const r = await createCoreRuntime(c, {
    worker,
    cloudflare,
    ensureTls: (config) => ensureLocalTls(config.stateDir, { trust: false }),
  } as any);
  await assert.rejects(r.start(), /tunnel-start-boom/);
  assert.equal(workerStarts, 1);
  assert.equal(workerCloses, 1);
  assert.equal(tunnelStops, 1);
});
