import assert from 'node:assert/strict';
import test from 'node:test';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { startWorkerServer } from '../../../apps/worker/src/server.js';
import { SocketWorkerClient } from '../src/client.js';
import { HmacEnvelopeSigner } from '../src/envelope.js';
test('authenticated IPC executes only signed envelope', async () => {
  const d = mkdtempSync(path.join(os.tmpdir(), 'aevra-ipc-'));
  const endpoint =
    process.platform === 'win32' ? `\\\\.\\pipe\\aevra-test-${Date.now()}` : path.join(d, 's.sock');
  const secret = Buffer.alloc(32, 3);
  const server = await startWorkerServer({ endpoint, secret, daemonInstanceId: 'd' });
  const client = new SocketWorkerClient(endpoint, secret, 'd');
  const signer = new HmacEnvelopeSigner(secret, 'd');
  const e = signer.sign({
    version: 1,
    daemonInstanceId: 'd',
    operationId: 'o',
    sessionId: 's',
    workspaceId: 'w',
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    nonce: 'n',
    executionMode: 'sandbox',
    capabilityRoots: [],
    operation: { kind: 'sandbox.inspect' },
  });
  const r = await client.execute(e);
  assert.equal(r.ok, true);

  const invalid = await client.execute({} as any);
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.code, 'UNAUTHORIZED');

  const health = await client.health();
  assert.equal(health.ready, true);

  // Redundant connect
  await client.connect();

  // Aborted signal
  const ac = new AbortController();
  ac.abort(new Error('aborted-early'));
  await assert.rejects(() => client.execute(e, ac.signal), /aborted-early/);

  await client.close();

  // Bad handshake client
  const badClient = new SocketWorkerClient(endpoint, Buffer.alloc(32, 9), 'd');
  await assert.rejects(() => badClient.health());
  await badClient.close();

  await new Promise<void>((res) => server.close(() => res()));
  rmSync(d, { recursive: true, force: true });
});
