import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadCoreConfig } from '../src/config.js';
import {
  createBrowserOriginPolicyService,
  createBrowserPairingService,
  createRuntimeWorkerManager,
} from '../src/runtime-support.js';

async function unusedPort() {
  const held = createServer();
  await new Promise<void>((resolve, reject) => {
    held.once('error', reject);
    held.listen(0, '127.0.0.1', resolve);
  });
  const port = (held.address() as { port: number }).port;
  await new Promise<void>((resolve) => held.close(() => resolve()));
  return port;
}

const settings = () => {
  const values = new Map<string, unknown>();
  return {
    get<T>(key: string, fallback: T): T {
      return (values.get(key) as T) ?? fallback;
    },
    set(key: string, value: unknown) {
      values.set(key, value);
    },
  };
};

test('configured WebSocket port is advertised by pairing and protected by origin policy', async () => {
  const config = loadCoreConfig(
    { AEVRA_USERNAME: 'admin', AEVRA_PASSWORD: 'ports-test' },
    { basePort: 50000 },
  );
  const store = settings();
  const key = randomBytes(32);
  const pairing = createBrowserPairingService(
    store,
    { browserTokenKey: () => key } as any,
    {
      execute: async () => ({
        ok: false,
        error: { code: 'WORKER_UNAVAILABLE', message: 'offline' },
      }),
    } as any,
    config,
  );
  const result = await pairing.redeem({
    code: pairing.createCode().code,
    extensionId: 'abcdefghijklmnopabcdefghijklmnop',
    profileId: '11111111-1111-4111-8111-111111111111',
    profileName: 'Custom ports',
  });
  assert.equal(result.wsUrl, 'ws://127.0.0.1:50003');
  const policy = createBrowserOriginPolicyService(store, config);
  assert.deepEqual(policy.snapshot().aevraPorts, [50000, 50001, 50002, 50003]);
});

test('runtime worker binds the requested WebSocket port in the child process', async (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'aevra-custom-ws-'));
  const port = await unusedPort();
  const config = loadCoreConfig(
    {
      AEVRA_USERNAME: 'admin',
      AEVRA_PASSWORD: 'ports-test',
      AEVRA_STATE_DIR: dir,
    },
    { wsPort: port },
  );
  const manager = createRuntimeWorkerManager(config, {});
  t.after(async () => {
    await manager.close();
    rmSync(dir, { recursive: true, force: true });
  });
  await manager.start();
  const reply = await manager.execute!({
    sessionId: 'admin:browser',
    workspaceId: 'system',
    roots: [],
    operation: { kind: 'browser.status', epoch: 1, pairings: [] },
  });
  assert.equal(reply.ok, true);
  assert.equal((reply as any).value.listener.state, 'listening');
  assert.equal((reply as any).value.listener.port, port);
  const probe = createServer();
  await assert.rejects(
    new Promise<void>((resolve, reject) => {
      probe.once('error', reject);
      probe.listen(port, '127.0.0.1', () => probe.close(() => resolve()));
    }),
    (error: any) => error.code === 'EADDRINUSE',
  );
});
