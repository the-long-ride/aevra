import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import type { VerifiedEnvelope, WorkerOperation } from '../../../packages/protocol/src/worker.js';
import { browserRuntime } from '../src/browser-runtime.js';
import { dispatchWorkerOperation } from '../src/dispatcher.js';
import { FakeDriver } from '../../../packages/browser/test/fake-driver.js';

function envelope(operation: WorkerOperation) {
  return {
    version: 1,
    daemonInstanceId: 'daemon',
    operationId: 'op',
    sessionId: 'session',
    workspaceId: 'workspace',
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    nonce: 'nonce',
    executionMode: 'host',
    capabilityRoots: [],
    operation,
    mac: 'mac',
    verifiedAt: new Date().toISOString(),
  } as VerifiedEnvelope;
}

test.beforeEach(() => {
  browserRuntime.configure({
    secret: randomBytes(32),
    createDriver: async (options) => new FakeDriver(options.transport),
  });
});

test.afterEach(async () => {
  await browserRuntime.shutdown();
});

test('browser operations before connect fail with BROWSER_NOT_CONNECTED', async () => {
  const result = await dispatchWorkerOperation(
    envelope({ kind: 'browser.snapshot', mode: 'a11y', maxNodes: 50 }),
  );
  assert.equal(result.ok, false);
  assert.equal(result.ok ? '' : result.error.code, 'BROWSER_NOT_CONNECTED');
});

test('connect then snapshot then act then disconnect all route through the registry', async () => {
  const connected = await dispatchWorkerOperation(
    envelope({ kind: 'browser.connect', transport: 'cdp', cdpPort: 9222 }),
  );
  assert.equal(connected.ok, true);
  assert.equal((connected as any).value.transport, 'cdp');

  const snapshot = await dispatchWorkerOperation(
    envelope({ kind: 'browser.snapshot', mode: 'a11y', maxNodes: 50 }),
  );
  assert.equal(snapshot.ok, true);
  assert.ok((snapshot as any).value.nodes.length >= 1);

  const acted = await dispatchWorkerOperation(
    envelope({
      kind: 'browser.act',
      actions: [{ op: 'press_key', key: 'Enter' }],
      stopOnError: true,
    }),
  );
  assert.equal(acted.ok, true);
  assert.equal((acted as any).value[0].ok, true);

  const gone = await dispatchWorkerOperation(envelope({ kind: 'browser.disconnect' }));
  assert.equal(gone.ok, true);

  const after = await dispatchWorkerOperation(envelope({ kind: 'browser.read', format: 'text' }));
  assert.equal(after.ok, false);
  assert.equal(after.ok ? '' : after.error.code, 'BROWSER_NOT_CONNECTED');
});

test('an envelope carrying a higher epoch revokes the live session', async () => {
  await dispatchWorkerOperation(envelope({ kind: 'browser.connect', transport: 'extension' }));
  const killed = await dispatchWorkerOperation(
    envelope({ kind: 'browser.disconnect', all: true, epoch: 7 }),
  );
  assert.equal(killed.ok, true);
  assert.equal(browserRuntime.registry().epoch(), 7);
  const after = await dispatchWorkerOperation(envelope({ kind: 'browser.tabs', action: 'list' }));
  assert.equal(after.ok, false);
  assert.equal(after.ok ? '' : after.error.code, 'BROWSER_NOT_CONNECTED');
});

test('a driver error is reported per action rather than thrown', async () => {
  await dispatchWorkerOperation(envelope({ kind: 'browser.connect', transport: 'cdp' }));
  await dispatchWorkerOperation(envelope({ kind: 'browser.snapshot', mode: 'a11y', maxNodes: 50 }));
  const stale = await dispatchWorkerOperation(
    envelope({
      kind: 'browser.act',
      actions: [{ op: 'click', ref: 'ref_0_0' }],
      stopOnError: true,
    }),
  );
  assert.equal(stale.ok, true);
  assert.equal((stale as any).value[0].error.code, 'BROWSER_REF_STALE');
});

test('connect carrying an extensionId pins it for the extension listener', async () => {
  await dispatchWorkerOperation(
    envelope({
      kind: 'browser.connect',
      transport: 'extension',
      extensionId: 'abcdefghijklmnopabcdefghijklmnop',
    }),
  );
  assert.equal(browserRuntime.extensionId(), 'abcdefghijklmnopabcdefghijklmnop');
});

test('every remaining browser route reaches its driver method', async () => {
  await dispatchWorkerOperation(envelope({ kind: 'browser.connect', transport: 'cdp' }));

  const tabs = await dispatchWorkerOperation(
    envelope({ kind: 'browser.tabs', action: 'open', url: 'https://example.com/', tabId: 'tab-1' }),
  );
  assert.equal(tabs.ok, true);

  const navigated = await dispatchWorkerOperation(
    envelope({
      kind: 'browser.navigate',
      url: 'https://example.com/reports',
      waitUntil: 'idle',
      tabId: 'tab-1',
    }),
  );
  assert.equal(navigated.ok, true);
  assert.equal((navigated as any).value.url, 'https://example.com/reports');

  const read = await dispatchWorkerOperation(
    envelope({ kind: 'browser.read', format: 'html', ref: 'ref_1_0', selector: '#x' }),
  );
  assert.equal(read.ok, true);
  assert.ok(String((read as any).value.content).length > 0);

  const logs = await dispatchWorkerOperation(
    envelope({ kind: 'browser.logs', logKind: 'console', limit: 5, since: 'x' }),
  );
  assert.equal(logs.ok, true);
  assert.ok(Array.isArray((logs as any).value));

  const vision = await dispatchWorkerOperation(
    envelope({ kind: 'browser.snapshot', mode: 'vision', maxNodes: 10, tabId: 'tab-1' }),
  );
  assert.equal(vision.ok, true);
  assert.ok(String((vision as any).value.imageDataUri).startsWith('data:image/'));
});

test('connect carrying an explicit tab and port forwards both', async () => {
  const connected = await dispatchWorkerOperation(
    envelope({ kind: 'browser.connect', transport: 'cdp', cdpPort: 9444, tabId: 'tab-9' }),
  );
  assert.equal(connected.ok, true);
  assert.equal((connected as any).value.transport, 'cdp');
});
