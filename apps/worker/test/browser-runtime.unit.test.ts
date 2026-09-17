import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { browserRuntime } from '../src/browser-runtime.js';

test.afterEach(async () => {
  await browserRuntime.shutdown();
});

test('an unconfigured runtime refuses to build a driver', async () => {
  browserRuntime.configure(undefined as unknown as { secret: Buffer });
  await assert.rejects(
    () => browserRuntime.registry().connect({ transport: 'cdp' }),
    /not configured/,
  );
});

test('the extension transport refuses until an extension is paired', async () => {
  browserRuntime.configure({ secret: randomBytes(32) });
  await browserRuntime.setExtensionId('');
  await assert.rejects(
    () => browserRuntime.registry().connect({ transport: 'extension' }),
    /No Aevra extension is paired/,
  );
});

test('setting the same extension id twice does not churn the listener', async () => {
  browserRuntime.configure({ secret: randomBytes(32) });
  const id = 'abcdefghijklmnopabcdefghijklmnop';
  await browserRuntime.setExtensionId(id);
  await browserRuntime.setExtensionId(id);
  assert.equal(browserRuntime.extensionId(), id);
});

test('a configured runtime reports a disconnected registry', async () => {
  browserRuntime.configure({ secret: randomBytes(32) });
  const status = await browserRuntime.registry().status();
  assert.equal(status.connected, false);
  assert.equal(status.transport, null);
  assert.equal(status.extensionPaired, false);
});
