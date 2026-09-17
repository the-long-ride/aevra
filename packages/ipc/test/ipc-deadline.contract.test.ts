import assert from 'node:assert/strict';
import test from 'node:test';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { createIpcServer } from '../src/server.js';
import {
  deadlineForEnvelope,
  IPC_DEFAULT_DEADLINE_MS,
  IPC_MAX_DEADLINE_MS,
  IPC_OVERHEAD_MS,
  SocketWorkerClient,
} from '../src/client.js';

function endpointFor(dir: string) {
  return process.platform === 'win32'
    ? `\\\\.\\pipe\\aevra-deadline-${Date.now()}-${Math.random().toString(36).slice(2)}`
    : path.join(dir, `s-${Math.random().toString(36).slice(2)}.sock`);
}

test('the transport deadline follows the operation instead of a flat ten seconds', () => {
  // A command allowed ten minutes must not be cut off by the transport at ten
  // seconds - that reported a timeout the caller never asked for while the
  // worker kept running the command.
  assert.equal(
    deadlineForEnvelope({
      operation: { kind: 'command.run', command: { timeoutMs: 600_000 } },
    } as any),
    600_000 + IPC_OVERHEAD_MS,
  );
  // process.wait defaults to 15s, which the old flat 10s deadline could never
  // outlive, so the default wait always failed.
  assert.equal(
    deadlineForEnvelope({ operation: { kind: 'process.wait', timeoutMs: 15_000 } } as any),
    15_000 + IPC_OVERHEAD_MS,
  );
  assert.equal(
    deadlineForEnvelope({ operation: { kind: 'sandbox.inspect' } } as any),
    IPC_DEFAULT_DEADLINE_MS + IPC_OVERHEAD_MS,
  );
});

test('an absurd or malformed operation bound is clamped, never unbounded', () => {
  assert.equal(
    deadlineForEnvelope({ operation: { command: { timeoutMs: Number.MAX_SAFE_INTEGER } } } as any),
    IPC_MAX_DEADLINE_MS,
  );
  for (const bogus of [0, -1, 'soon', null, undefined, NaN]) {
    assert.equal(
      deadlineForEnvelope({ operation: { command: { timeoutMs: bogus } } } as any),
      IPC_DEFAULT_DEADLINE_MS + IPC_OVERHEAD_MS,
      `${String(bogus)} should fall back to the default, not become the deadline`,
    );
  }
});

test('closing the client rejects callers instead of leaving them pending forever', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'aevra-ipc-deadline-'));
  const endpoint = endpointFor(dir);
  const secret = Buffer.alloc(32, 5);
  // A handler that never answers: the reply can only arrive after close, which
  // is exactly the case that used to hang.
  const server = createIpcServer(endpoint, secret, 'd', {
    health: () => new Promise(() => {}),
    execute: () => new Promise(() => {}),
  });
  await new Promise<void>((res, rej) => {
    server.once('error', rej);
    server.listen(endpoint, res);
  });

  const client = new SocketWorkerClient(endpoint, secret, 'd');
  const inFlight = client.health();
  const settled = assert.rejects(() => inFlight, /closed/);
  await new Promise((res) => setTimeout(res, 50));
  await client.close();
  await settled;

  await new Promise<void>((res) => server.close(() => res()));
  rmSync(dir, { recursive: true, force: true });
});

test('a slow operation does not block other requests on the same socket', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'aevra-ipc-hol-'));
  const endpoint = endpointFor(dir);
  const secret = Buffer.alloc(32, 6);
  let releaseSlow: (() => void) | undefined;
  const server = createIpcServer(endpoint, secret, 'd', {
    async health() {
      return { ready: true, pid: 1 };
    },
    execute: () =>
      new Promise((resolve) => {
        releaseSlow = () => resolve({ ok: true, value: 'slow' });
      }),
  });
  await new Promise<void>((res, rej) => {
    server.once('error', rej);
    server.listen(endpoint, res);
  });

  const client = new SocketWorkerClient(endpoint, secret, 'd');
  const slow = client.execute({ operation: { kind: 'sandbox.inspect' } } as any);
  // The decode loop used to await each handler inline, so this health probe sat
  // behind the unfinished execute above for as long as it ran.
  const health = await client.health();
  assert.equal(health.ready, true);

  releaseSlow?.();
  assert.deepEqual(await slow, { ok: true, value: 'slow' });

  await client.close();
  await new Promise<void>((res) => server.close(() => res()));
  rmSync(dir, { recursive: true, force: true });
});
