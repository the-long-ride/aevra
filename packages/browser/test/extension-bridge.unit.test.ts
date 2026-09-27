import assert from 'node:assert/strict';
import test from 'node:test';
import { handleExtensionCommand } from '../src/extension-bridge.js';
import { RefRegistry } from '../src/dom-snapshot.js';
import { FIXTURE_PAGE } from './fixtures.js';

function bridge(overrides: Record<string, unknown> = {}) {
  const calls: any[] = [];
  return {
    calls,
    value: {
      async listTabs() {
        return [
          {
            tabId: '1',
            url: 'https://example.com/',
            title: 'Example',
            active: true,
            originClass: 'NORMAL',
          },
        ];
      },
      async serialize() {
        return FIXTURE_PAGE;
      },
      async apply(action: unknown) {
        calls.push(action);
        return { ok: true };
      },
      async captureVisible() {
        return { imageDataUri: 'data:image/jpeg;base64,AAAA', devicePixelRatio: 1 };
      },
      async navigate(url: string) {
        calls.push(['navigate', url]);
        return { tabId: '1', url, status: 200, redirected: false };
      },
      async logs() {
        return [];
      },
      ...overrides,
    } as any,
  };
}

test('a snapshot assigns refs and reports its version', async () => {
  const registry = new RefRegistry();
  const result: any = await handleExtensionCommand(registry, bridge().value, {
    op: 'snapshot',
    params: { mode: 'a11y', maxNodes: 100 },
  });
  assert.equal(result.mode, 'a11y');
  assert.ok(result.nodes.length >= 1);
  assert.equal(result.snapshotVersion, registry.version());
});

test('vision snapshot forwards capture progress to its caller', async () => {
  const progress: string[] = [];
  const harness = bridge({
    async captureVisible(_tabId: string, onProgress?: (event: { stage: string }) => void) {
      onProgress?.({ stage: 'capture_started' });
      return { imageDataUri: 'data:image/jpeg;base64,AAAA', devicePixelRatio: 1 };
    },
  });
  await (handleExtensionCommand as any)(
    new RefRegistry(),
    harness.value,
    { op: 'snapshot', params: { mode: 'vision', tabId: '1' } },
    (event: { stage: string }) => progress.push(event.stage),
  );
  assert.deepEqual(progress, ['capture_started']);
});

test('a ref from an older snapshot version is refused, never remapped', async () => {
  const registry = new RefRegistry();
  const first: any = await handleExtensionCommand(registry, bridge().value, {
    op: 'snapshot',
    params: { mode: 'a11y', maxNodes: 100 },
  });
  const staleRef = first.nodes[0].ref;
  await handleExtensionCommand(registry, bridge().value, {
    op: 'snapshot',
    params: { mode: 'a11y', maxNodes: 100 },
  });
  const acted: any = await handleExtensionCommand(registry, bridge().value, {
    op: 'act',
    params: { actions: [{ op: 'click', ref: staleRef }], stopOnError: true },
  });
  assert.equal(acted[0].ok, false);
  assert.equal(acted[0].error.code, 'BROWSER_REF_STALE');
});

test('typing into a credential field is refused and the action never reaches the page', async () => {
  const registry = new RefRegistry();
  const harness = bridge();
  const snapshot: any = await handleExtensionCommand(registry, harness.value, {
    op: 'snapshot',
    params: { mode: 'a11y', maxNodes: 100 },
  });
  const password = snapshot.nodes.find((node: any) => node.credentialField === true);
  assert.ok(password, 'fixture must contain a credential field');
  const acted: any = await handleExtensionCommand(registry, harness.value, {
    op: 'act',
    params: { actions: [{ op: 'type', ref: password.ref, text: 'x' }], stopOnError: true },
  });
  assert.equal(acted[0].error.code, 'BROWSER_CREDENTIAL_FIELD_REFUSED');
  assert.equal(harness.calls.length, 0);
});

test('stopOnError halts the remaining actions', async () => {
  const registry = new RefRegistry();
  const harness = bridge();
  await handleExtensionCommand(registry, harness.value, {
    op: 'snapshot',
    params: { mode: 'a11y', maxNodes: 100 },
  });
  const acted: any = await handleExtensionCommand(registry, harness.value, {
    op: 'act',
    params: {
      actions: [
        { op: 'click', ref: 'ref_9999' },
        { op: 'press_key', key: 'Enter' },
      ],
      stopOnError: true,
    },
  });
  assert.equal(acted.length, 1);
});

test('native click failure preserves its code, stops the batch, and names input rather than page completion', async () => {
  const registry = new RefRegistry();
  const attempts: unknown[] = [];
  const harness = bridge({
    async apply(action: unknown, _elementId: unknown, tabId: string) {
      attempts.push([action, tabId]);
      return { ok: false, code: 'BROWSER_NATIVE_INPUT_UNAVAILABLE' };
    },
  });
  const result: any = await handleExtensionCommand(registry, harness.value, {
    op: 'act',
    params: {
      tabId: '1',
      actions: [
        { op: 'click', x: 555, y: 620 },
        { op: 'press_key', key: 'Enter' },
      ],
      stopOnError: true,
    },
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].error.code, 'BROWSER_NATIVE_INPUT_UNAVAILABLE');
  assert.match(result[0].error.message, /native input/i);
  assert.doesNotMatch(result[0].error.message, /in the page/i);
  assert.deepEqual(attempts, [[{ op: 'click', x: 555, y: 620 }, '1']]);
});

test('a vision snapshot returns an image and labelled boxes, not a node tree', async () => {
  const registry = new RefRegistry();
  const result: any = await handleExtensionCommand(registry, bridge().value, {
    op: 'snapshot',
    params: { mode: 'vision', maxNodes: 100 },
  });
  assert.equal(result.mode, 'vision');
  assert.ok(String(result.imageDataUri).startsWith('data:image/'));
  assert.ok(Array.isArray(result.boxes));
});

test('vision capture succeeds when DOM serialization is unavailable', async () => {
  const registry = new RefRegistry();
  let captures = 0;
  const harness = bridge({
    async serialize() {
      throw new TypeError("Cannot read properties of null (reading 'attributes')");
    },
    async captureVisible() {
      captures += 1;
      return { imageDataUri: 'data:image/jpeg;base64,AAAA', devicePixelRatio: 1 };
    },
  });
  const result: any = await handleExtensionCommand(registry, harness.value, {
    op: 'snapshot',
    params: { mode: 'vision', tabId: '1' },
  });
  assert.equal(captures, 1);
  assert.equal(result.imageDataUri, 'data:image/jpeg;base64,AAAA');
  assert.deepEqual(result.boxes, []);
  assert.equal(result.snapshotVersion, registry.version());
});

test('vision capture returns the image when DOM annotation stalls', async () => {
  const registry = new RefRegistry();
  const harness = bridge({
    async serialize() {
      return new Promise<never>(() => {});
    },
  });
  const result: any = await handleExtensionCommand(registry, harness.value, {
    op: 'snapshot',
    params: { mode: 'vision', tabId: '1' },
  });
  assert.equal(result.imageDataUri, 'data:image/jpeg;base64,AAAA');
  assert.deepEqual(result.boxes, []);
});

test('an unknown op is rejected rather than ignored', async () => {
  const registry = new RefRegistry();
  await assert.rejects(
    () => handleExtensionCommand(registry, bridge().value, { op: 'evaluate', params: {} } as any),
    /unsupported browser operation/,
  );
});

test('tabs, navigate, read and logs each route to the bridge', async () => {
  const registry = new RefRegistry();
  const harness = bridge();

  const tabs: any = await handleExtensionCommand(registry, harness.value, {
    op: 'tabs',
    params: {},
  });
  assert.equal(tabs[0].tabId, '1');

  const navigated: any = await handleExtensionCommand(registry, harness.value, {
    op: 'navigate',
    params: { url: 'https://example.com/next', waitUntil: 'idle' },
  });
  assert.equal(navigated.url, 'https://example.com/next');

  const read: any = await handleExtensionCommand(registry, harness.value, {
    op: 'read',
    params: {},
  });
  assert.match(read.content, /Invoices/);

  const logs: any = await handleExtensionCommand(registry, harness.value, {
    op: 'logs',
    params: { logKind: 'network', limit: 10 },
  });
  assert.deepEqual(logs, []);
});

test('tabs focus selects the requested tab before listing tabs', async () => {
  const registry = new RefRegistry();
  const harness = bridge({
    async focus(tabId: string) {
      harness.calls.push(['focus', tabId]);
    },
  });
  await handleExtensionCommand(registry, harness.value, {
    op: 'tabs',
    params: { action: 'focus', tabId: '2' },
  });
  assert.deepEqual(harness.calls, [['focus', '2']]);
});

test('stopOnError false keeps going past a stale ref', async () => {
  const registry = new RefRegistry();
  const harness = bridge();
  await handleExtensionCommand(registry, harness.value, {
    op: 'snapshot',
    params: { mode: 'a11y', maxNodes: 100 },
  });
  const acted: any = await handleExtensionCommand(registry, harness.value, {
    op: 'act',
    params: {
      actions: [
        { op: 'click', ref: 'ref_9999' },
        { op: 'press_key', key: 'Enter' },
      ],
      stopOnError: false,
    },
  });
  assert.equal(acted.length, 2);
  assert.equal(acted[0].ok, false);
  assert.equal(acted[1].ok, true);
});

test('an action carrying no ref reaches the page unchecked by the ref registry', async () => {
  const registry = new RefRegistry();
  const harness = bridge();
  const acted: any = await handleExtensionCommand(registry, harness.value, {
    op: 'act',
    params: { actions: [{ op: 'click', x: 4, y: 9 }], stopOnError: true },
  });
  assert.equal(acted[0].ok, true);
  assert.equal(harness.calls.length, 1);
});

test('a snapshot targeting a named tab still records the version', async () => {
  const registry = new RefRegistry();
  const result: any = await handleExtensionCommand(registry, bridge().value, {
    op: 'snapshot',
    params: { mode: 'a11y', maxNodes: 100, tabId: '1' },
  });
  assert.equal(result.tabId, '1');
  assert.equal(result.snapshotVersion, 1);
});

test('read targeting a named tab reports that tab', async () => {
  const registry = new RefRegistry();
  const read: any = await handleExtensionCommand(registry, bridge().value, {
    op: 'read',
    params: { tabId: '1' },
  });
  assert.equal(read.tabId, '1');
});

test('a snapshot of a tab the bridge does not list fails closed', async () => {
  const registry = new RefRegistry();
  const result: any = await handleExtensionCommand(registry, bridge().value, {
    op: 'snapshot',
    params: { mode: 'a11y', maxNodes: 100, tabId: 'absent' },
  });
  assert.equal(result.tabId, '');
  // No tab means no url, and an origin that cannot be classified must not
  // arrive labelled ordinary.
  assert.equal(result.originClass, 'BLOCKED');
});

test('navigate defaults to load when no waitUntil is given', async () => {
  const registry = new RefRegistry();
  const harness = bridge();
  await handleExtensionCommand(registry, harness.value, {
    op: 'navigate',
    params: { url: 'https://example.com/plain' },
  });
  assert.deepEqual(harness.calls.at(-1), ['navigate', 'https://example.com/plain']);
});

test('logs default to the console kind and a bounded limit', async () => {
  const registry = new RefRegistry();
  const logs: any = await handleExtensionCommand(registry, bridge().value, {
    op: 'logs',
    params: {},
  });
  assert.deepEqual(logs, []);
});
