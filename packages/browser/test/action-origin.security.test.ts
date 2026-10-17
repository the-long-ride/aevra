import { validateDebuggerUrl } from '../src/action-origin.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { CdpDriver } from '../src/cdp-driver.js';
import { RefRegistry } from '../src/dom-snapshot.js';
import { handleExtensionCommand } from '../src/extension-bridge.js';

const safe = 'https://example.com/';
const blocked = 'http://localhost:47831/';
const actions = [
  { op: 'press_key' as const, key: 'Enter' },
  { op: 'press_key' as const, key: 'Enter' },
];

test('CDP aborts a batch when an earlier action navigates into the admin origin', async () => {
  let url = safe;
  let inputs = 0;
  const driver: any = new CdpDriver();
  driver.sessions = {
    target: async () => ({
      id: 'one',
      client: {
        send: async (method: string) => {
          if (method === 'Page.getNavigationHistory')
            return { entries: [{ url }], currentIndex: 0 };
          if (method === 'Input.dispatchKeyEvent') {
            inputs++;
            url = blocked;
          }
          return {};
        },
      },
    }),
  };
  await assert.rejects(
    () => driver.act(actions, { stopOnError: false, expectedUrl: safe }),
    (e: any) => e.code === 'BROWSER_ORIGIN_BLOCKED',
  );
  assert.ok(inputs <= 2, 'the second action never receives input');
});

test('extension batch aborts on origin change even when stopOnError is false', async () => {
  let url = safe;
  let applied = 0;
  const bridge: any = {
    listTabs: async () => [{ tabId: 'one', active: true, url }],
    apply: async () => {
      applied++;
      url = blocked;
      return { ok: true };
    },
  };
  await assert.rejects(
    () =>
      handleExtensionCommand(new RefRegistry(), bridge, {
        op: 'act',
        params: { actions, stopOnError: false, expectedUrl: safe },
      }),
    (e: any) => e.code === 'BROWSER_ORIGIN_BLOCKED',
  );
  assert.equal(applied, 1);
});

test('debugger WebSockets stay on the configured loopback port', () => {
  for (const url of [
    'ws://remote.example:9222/devtools/page',
    'ws://127.0.0.1:47831/devtools/page',
    'wss://127.0.0.1:9222/devtools/page',
    'ws://user@127.0.0.1:9222/devtools/page',
  ]) {
    assert.throws(() => validateDebuggerUrl(url, 9222), { code: 'BROWSER_ORIGIN_BLOCKED' });
  }
  assert.equal(
    validateDebuggerUrl('ws://127.0.0.1:9222/devtools/page', 9222),
    'ws://127.0.0.1:9222/devtools/page',
  );
});

test('same-origin navigation into a sensitive route stops a MEDIUM batch', async () => {
  let url = 'https://github.com/example';
  let applied = 0;
  const bridge: any = {
    listTabs: async () => [{ tabId: 'one', active: true, url }],
    apply: async () => {
      applied++;
      url = 'https://github.com/settings/profile';
      return { ok: true };
    },
  };
  await assert.rejects(
    () =>
      handleExtensionCommand(new RefRegistry(), bridge, {
        op: 'act',
        params: { actions, stopOnError: false, expectedUrl: url },
      }),
    { code: 'BROWSER_ORIGIN_BLOCKED' },
  );
  assert.equal(applied, 1);
});

for (const op of ['read', 'snapshot'] as const)
  test(`extension ${op} discards content when navigation occurs during the read`, async () => {
    let url = safe;
    const bridge: any = {
      listTabs: async () => [{ tabId: 'one', active: true, url }],
      serialize: async () => {
        url = blocked;
        return {
          tagName: 'div',
          attributes: {},
          children: [],
          textContent: 'private ordinary words',
        };
      },
    };
    await assert.rejects(
      () =>
        handleExtensionCommand(new RefRegistry(), bridge, {
          op,
          params: { mode: 'a11y', expectedUrl: safe },
        }),
      { code: 'BROWSER_ORIGIN_BLOCKED' },
    );
  });

test('CDP read discards content when navigation occurs while reading', async () => {
  let url = safe;
  const driver: any = new CdpDriver();
  driver.sessions = {
    target: async () => ({
      id: 'one',
      client: {
        send: async (method: string) => {
          if (method === 'Page.getNavigationHistory')
            return { entries: [{ url }], currentIndex: 0 };
          if (method === 'DOM.getDocument') {
            url = blocked;
            return { root: { nodeId: 1 } };
          }
          if (method === 'DOM.getOuterHTML') return { outerHTML: '<p>private ordinary words</p>' };
          return {};
        },
      },
    }),
  };
  await assert.rejects(() => driver.read({ format: 'html', expectedUrl: safe }), {
    code: 'BROWSER_ORIGIN_BLOCKED',
  });
});

test('failed snapshot refs cannot expose cached protected content on a later safe read', async () => {
  let url = safe;
  const registry = new RefRegistry();
  const bridge: any = {
    listTabs: async () => [{ tabId: 'one', active: true, url }],
    serialize: async () => {
      url = blocked;
      return {
        tagName: 'h1',
        attributes: {},
        children: [],
        textContent: 'private ordinary heading',
      };
    },
  };
  await assert.rejects(
    () =>
      handleExtensionCommand(registry, bridge, {
        op: 'snapshot',
        params: { mode: 'a11y', expectedUrl: safe },
      }),
    { code: 'BROWSER_ORIGIN_BLOCKED' },
  );
  url = safe;
  bridge.serialize = async () => ({
    tagName: 'body',
    attributes: {},
    children: [],
    textContent: 'ordinary page',
  });
  await assert.rejects(
    () => handleExtensionCommand(registry, bridge, { op: 'read', params: { ref: 'ref_1_0' } }),
    /BROWSER_REF_STALE/,
  );
});

test('extension refs are bound to the observed tab and document', async () => {
  const registry = new RefRegistry();
  let documentId = 'first document';
  const bridge: any = {
    listTabs: async () => [
      { tabId: 'one', active: true, url: safe },
      { tabId: 'two', active: false, url: safe },
    ],
    serialize: async () => ({
      documentId,
      tagName: 'h1',
      attributes: {},
      children: [],
      textContent: 'ordinary heading',
    }),
  };
  await handleExtensionCommand(registry, bridge, { op: 'snapshot', params: { mode: 'a11y' } });
  await assert.rejects(
    () =>
      handleExtensionCommand(registry, bridge, {
        op: 'read',
        params: { tabId: 'two', ref: 'ref_1_0' },
      }),
    { code: 'BROWSER_REF_STALE' },
  );
  await handleExtensionCommand(registry, bridge, { op: 'snapshot', params: { mode: 'a11y' } });
  const ref = `ref_${registry.version()}_0`;
  documentId = 'replacement document';
  await assert.rejects(
    () => handleExtensionCommand(registry, bridge, { op: 'read', params: { ref } }),
    { code: 'BROWSER_REF_STALE' },
  );
});
