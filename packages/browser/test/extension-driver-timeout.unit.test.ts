import assert from 'node:assert/strict';
import test from 'node:test';
import { ExtensionDriver } from '../src/extension-driver.js';
import type { ExtensionServer } from '../src/extension-server.js';

test('vision snapshots have a capture budget separate from ordinary RPCs', async () => {
  const calls: Array<{ op: string; timeoutMs: number | undefined }> = [];
  const server = {
    peer: () => 'peer',
    peerId: () => 'peer',
    async call(op: string, _params: unknown, timeoutMs?: number) {
      calls.push({ op, timeoutMs });
      return op === 'tabs' ? [] : {};
    },
  } as unknown as ExtensionServer;
  const driver = new ExtensionDriver(server);
  await driver.connect({ transport: 'extension' });
  await driver.snapshot({ mode: 'vision', maxNodes: 100 });
  await driver.snapshot({ mode: 'a11y', maxNodes: 100 });
  assert.deepEqual(calls, [
    { op: 'tabs', timeoutMs: undefined },
    { op: 'snapshot', timeoutMs: 30_000 },
    { op: 'snapshot', timeoutMs: undefined },
  ]);
});
