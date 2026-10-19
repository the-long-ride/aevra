import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createConnection, createServer, type Server } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parseAevraArgs } from '../../cli/src/args.js';
import { loadCoreConfig } from '../src/config.js';
import { createCoreRuntime } from '../src/runtime.js';
import { ensureLocalTls } from '../src/tls/local-tls.js';

async function hold(port: number): Promise<Server> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return server;
}
const close = (server: Server) => new Promise<void>((resolve) => server.close(() => resolve()));

async function availableBlock() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const held: Server[] = [];
    const base = randomInt(20000, 40000);
    try {
      for (let offset = 0; offset < 4; offset += 1) held.push(await hold(base + offset));
      return base;
    } catch {
      /* Another process owns a neighbour; try a different block. */
    } finally {
      await Promise.all(held.map(close));
    }
  }
  throw new Error('Could not find an available four-port block');
}

function config(dir: string, base: number) {
  const command = parseAevraArgs(['start', '--ui', `--basePort=${base}`]);
  assert.equal(command.command, 'start');
  return loadCoreConfig(
    {
      AEVRA_USERNAME: 'admin',
      AEVRA_PASSWORD: 'custom-port-test',
      AEVRA_STATE_DIR: dir,
    },
    command.command === 'start' ? command.ports : undefined,
  );
}

test('a base-port startup binds all four real listeners and closes the complete block', async (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'aevra-base-live-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const base = await availableBlock();
  const runtime = await createCoreRuntime(config(dir, base), {
    ensureTls: (current) => ensureLocalTls(current.stateDir, { trust: false }),
  });
  try {
    await runtime.start();
    assert.equal(new URL(runtime.gatewayUrl).port, String(base));
    assert.equal(new URL(runtime.adminUrl).port, String(base + 1));
    assert.equal(new URL(runtime.mcpUrl).port, String(base + 2));
    for (const port of [base, base + 1, base + 2, base + 3]) {
      await new Promise<void>((resolve, reject) => {
        const socket = createConnection({ host: '127.0.0.1', port });
        socket.once('connect', () => {
          socket.destroy();
          resolve();
        });
        socket.once('error', reject);
      });
    }
  } finally {
    await runtime.close();
  }
  for (const port of [base, base + 1, base + 2, base + 3]) await close(await hold(port));
});

test('an occupied extension port fails startup and releases the other three listeners', async (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'aevra-ws-conflict-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const base = await availableBlock();
  const blocker = await hold(base + 3);
  const runtime = await createCoreRuntime(config(dir, base), {
    ensureTls: (current) => ensureLocalTls(current.stateDir, { trust: false }),
  });
  try {
    await assert.rejects(runtime.start(), /WebSocket.*EADDRINUSE/i);
    for (const port of [base, base + 1, base + 2]) await close(await hold(port));
  } finally {
    await runtime.close();
    await close(blocker);
  }
});
