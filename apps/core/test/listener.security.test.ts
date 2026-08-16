import assert from 'node:assert/strict';
import test from 'node:test';
import { AdminServer } from '../src/admin/server.js';
import { McpIngressServer } from '../src/mcp/server.js';
import { ensureLocalTls } from '../src/tls/local-tls.js';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
test('admin and MCP bind exactly loopback', async () => {
  const tls = await ensureLocalTls(mkdtempSync(path.join(os.tmpdir(), 'aevra-listener-')), {
    trust: false,
  });
  const a = new AdminServer('127.0.0.1', 0, () => ({}), {
    tls: tls.serverOptions,
    advertisedHost: 'localhost',
  });
  const m = new McpIngressServer(
    '127.0.0.1',
    0,
    undefined as any,
    undefined,
    undefined,
    undefined,
    undefined,
    { tls: tls.serverOptions, advertisedHost: 'localhost' },
  );
  await a.start();
  await m.start();
  assert.match(a.url(), /^https:\/\/localhost:/);
  assert.match(m.url(), /^https:\/\/localhost:/);
  for (const x of [a.address(), m.address()]) {
    assert.ok(x && typeof x !== 'string');
    assert.equal((x as any).address, '127.0.0.1');
  }
  await m.close();
  await a.close();
});
