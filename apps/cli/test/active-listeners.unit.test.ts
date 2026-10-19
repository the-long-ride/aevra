import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadCoreConfig } from '../../core/src/config.js';
import {
  activeListenerConfig,
  runStartWithDiscovery as runStart,
} from '../src/active-listeners.js';

test('startup publishes actual ports for later CLI commands and removes the owned record on shutdown', async (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'aevra-listeners-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const config = loadCoreConfig({
    AEVRA_USERNAME: 'admin',
    AEVRA_PASSWORD: 'ports-test',
    AEVRA_STATE_DIR: dir,
  });
  const signals = new EventEmitter();
  let ready!: () => void;
  const announced = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const pending = runStart(config, {
    signals,
    createRuntime: async () => ({
      adminUrl: 'https://localhost:50001',
      mcpUrl: 'https://localhost:50002',
      gatewayUrl: 'https://127.0.0.1:50000',
      publicUrl: undefined,
      start: async () => {},
      close: async () => {},
    }),
    onReady: () => ready(),
  });
  await announced;
  await new Promise<void>((resolve) => setImmediate(resolve));
  try {
    const record = JSON.parse(readFileSync(path.join(dir, 'listeners.json'), 'utf8'));
    assert.equal(record.pid, process.pid);
    assert.deepEqual(record.ports, {
      publicPort: 50000,
      adminPort: 50001,
      mcpPort: 50002,
      browserPort: 47833,
    });
    const current = activeListenerConfig(config);
    assert.deepEqual(
      [current.publicPort, current.adminPort, current.mcpPort],
      [50000, 50001, 50002],
    );
  } finally {
    signals.emit('SIGTERM');
    assert.equal(await pending, 0);
  }
  assert.equal(existsSync(path.join(dir, 'listeners.json')), false);
});

test('malformed and stale listener records cannot redirect CLI commands', (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'aevra-listeners-stale-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const config = loadCoreConfig({
    AEVRA_USERNAME: 'admin',
    AEVRA_PASSWORD: 'ports-test',
    AEVRA_STATE_DIR: dir,
  });
  for (const contents of [
    '{broken',
    JSON.stringify({
      version: 1,
      pid: 2147483647,
      owner: 'stale',
      ports: { publicPort: 50000, adminPort: 50001, mcpPort: 50002, browserPort: 50003 },
    }),
    JSON.stringify({ version: 1, pid: process.pid, owner: 'bad', ports: { adminPort: 0 } }),
  ]) {
    writeFileSync(path.join(dir, 'listeners.json'), contents);
    assert.equal(activeListenerConfig(config), config);
  }
});

test('readiness failures close the runtime instead of leaving custom listeners alive', async (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'aevra-listeners-error-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const config = loadCoreConfig({
    AEVRA_USERNAME: 'admin',
    AEVRA_PASSWORD: 'ports-test',
    AEVRA_STATE_DIR: dir,
  });
  let closed = false;
  await assert.rejects(
    runStart(config, {
      signals: new EventEmitter(),
      createRuntime: async () => ({
        adminUrl: 'https://localhost:50001',
        mcpUrl: 'https://localhost:50002',
        gatewayUrl: 'https://127.0.0.1:50000',
        publicUrl: undefined,
        start: async () => {},
        close: async () => {
          closed = true;
        },
      }),
      onReady: () => {
        throw new Error('cannot announce');
      },
    }),
    /cannot announce/,
  );
  assert.equal(closed, true);
  assert.equal(existsSync(path.join(dir, 'listeners.json')), false);
});
