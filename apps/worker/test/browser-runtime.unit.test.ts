import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import test from 'node:test';
import { browserRuntime } from '../src/browser-runtime.js';

test.afterEach(async () => {
  await browserRuntime.shutdown();
});

test('an unconfigured runtime refuses to build a driver', async () => {
  browserRuntime.configure(undefined as unknown as { browserTokenKey: Buffer });
  await assert.rejects(
    () => browserRuntime.registry().connect({ transport: 'cdp' }),
    /not configured/,
  );
});

test('the extension transport refuses until an extension is paired', async () => {
  browserRuntime.configure({ browserTokenKey: randomBytes(32), extensionPort: 0 });
  await browserRuntime.setExtensionId('');
  await assert.rejects(
    () => browserRuntime.registry().connect({ transport: 'extension' }),
    /no authenticated.*extension socket/i,
  );
});

test('setting the same extension id twice does not churn the listener', async () => {
  browserRuntime.configure({ browserTokenKey: randomBytes(32), extensionPort: 0 });
  const id = 'abcdefghijklmnopabcdefghijklmnop';
  await browserRuntime.setExtensionId(id);
  await browserRuntime.setExtensionId(id);
  assert.equal(browserRuntime.extensionId(), id);
});

test('a configured runtime reports a disconnected registry', async () => {
  browserRuntime.configure({ browserTokenKey: randomBytes(32), extensionPort: 0 });
  const status = await browserRuntime.registry().status();
  assert.equal(status.connected, false);
  assert.equal(status.transport, null);
  assert.equal(status.extensionPaired, false);
});

test('occupied extension port is reported as failed listener health', async () => {
  const occupied = createServer();
  await new Promise<void>((resolve) => occupied.listen(0, '127.0.0.1', resolve));
  const address = occupied.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  try {
    browserRuntime.configure({ browserTokenKey: randomBytes(32), extensionPort: port });
    await browserRuntime.setExtensionId('porthealthabcdefghijklmnopabcdef');
    const health = browserRuntime.listenerHealth();
    assert.equal(health.state, 'failed');
    assert.equal(health.errorCode, 'EADDRINUSE');
    assert.equal(health.port, port);
  } finally {
    await new Promise<void>((resolve) => occupied.close(() => resolve()));
  }
});
