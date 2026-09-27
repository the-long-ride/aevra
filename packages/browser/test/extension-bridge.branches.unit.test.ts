import assert from 'node:assert/strict';
import test from 'node:test';
import { handleExtensionCommand } from '../src/extension-bridge.js';
import { RefRegistry, type SnapshotElementLike } from '../src/dom-snapshot.js';
import { FIXTURE_PAGE } from './fixtures.js';

function bridge(overrides: Record<string, unknown> = {}) {
  const applied: any[] = [];
  return {
    applied,
    value: {
      async listTabs() {
        return [
          { tabId: '1', url: 'https://example.com/', title: 'One', active: true },
          { tabId: '2', url: 'https://example.org/', title: 'Two', active: false },
        ];
      },
      async focus() {},
      async serialize() {
        return FIXTURE_PAGE;
      },
      async apply(action: unknown, elementId: unknown, tabId: unknown) {
        applied.push({ action, elementId, tabId });
        return { ok: true };
      },
      async captureVisible() {
        return { imageDataUri: 'data:image/jpeg;base64,AAAA', devicePixelRatio: 2 };
      },
      async navigate(url: string) {
        return { tabId: '1', url, status: 200, redirected: false };
      },
      async logs() {
        return [];
      },
      ...overrides,
    } as any,
  };
}

test('a vision capture scale converts later coordinate clicks and drags back to CSS pixels', async () => {
  const registry = new RefRegistry();
  const harness = bridge();
  await handleExtensionCommand(registry, harness.value, {
    op: 'snapshot',
    params: { mode: 'vision' },
  });
  const acted: any = await handleExtensionCommand(registry, harness.value, {
    op: 'act',
    params: {
      actions: [
        { op: 'click', x: 100, y: 50 },
        { op: 'drag', x: 20, y: 40, toX: 60, toY: 80 },
      ],
    },
  });
  assert.deepEqual(
    acted.map((result: any) => result.ok),
    [true, true],
  );
  // No tabId: the active tab's remembered scale (2) applies.
  assert.deepEqual(harness.applied[0].action, { op: 'click', x: 50, y: 25 });
  assert.deepEqual(harness.applied[1].action, { op: 'drag', x: 10, y: 20, toX: 30, toY: 40 });
});

test('a tab without a remembered capture scale keeps coordinates unchanged', async () => {
  const registry = new RefRegistry();
  const harness = bridge();
  await handleExtensionCommand(registry, harness.value, {
    op: 'snapshot',
    params: { mode: 'vision', tabId: '1' },
  });
  await handleExtensionCommand(registry, harness.value, {
    op: 'act',
    params: { tabId: '2', actions: [{ op: 'click', x: 100, y: 50 }] },
  });
  assert.deepEqual(harness.applied[0].action, { op: 'click', x: 100, y: 50 });
  assert.equal(harness.applied[0].tabId, '2');
});

test('with no active tab the scale lookup falls back to an unscaled point', async () => {
  const registry = new RefRegistry();
  const harness = bridge({
    async listTabs() {
      return [];
    },
  });
  await handleExtensionCommand(registry, harness.value, {
    op: 'snapshot',
    params: { mode: 'vision' },
  });
  await handleExtensionCommand(registry, harness.value, {
    op: 'act',
    params: { actions: [{ op: 'click', x: 8, y: 6 }] },
  });
  // The capture was remembered under '' (no tab) with scale 2.
  assert.deepEqual(harness.applied[0].action, { op: 'click', x: 4, y: 3 });
});

test('an act command without an actions array does nothing', async () => {
  const harness = bridge();
  const acted = await handleExtensionCommand(new RefRegistry(), harness.value, {
    op: 'act',
    params: { actions: 'click' },
  });
  assert.deepEqual(acted, []);
  assert.equal(harness.applied.length, 0);
});

test('a cancelled act stops before reaching the page', async () => {
  const harness = bridge();
  await assert.rejects(
    handleExtensionCommand(
      new RefRegistry(),
      harness.value,
      { op: 'act', params: { actions: [{ op: 'press_key', key: 'Enter' }] } },
      undefined,
      () => true,
    ),
    (error: any) => error.code === 'BROWSER_INPUT_FAILED' && /cancelled/.test(error.message),
  );
  assert.equal(harness.applied.length, 0);
});

test('a ref whose element has no isolated-world identity is refused as stale', async () => {
  const root: SnapshotElementLike = {
    tagName: 'body',
    attributes: {},
    textContent: '',
    children: [{ tagName: 'button', attributes: {}, children: [], textContent: 'Go' }],
  };
  const registry = new RefRegistry();
  const harness = bridge({
    async serialize() {
      return root;
    },
  });
  const snap: any = await handleExtensionCommand(registry, harness.value, {
    op: 'snapshot',
    params: { mode: 'a11y' },
  });
  const ref = snap.nodes[0].ref;
  const acted: any = await handleExtensionCommand(registry, harness.value, {
    op: 'act',
    params: {
      actions: [
        { op: 'click', ref },
        { op: 'press_key', key: 'Enter' },
      ],
      stopOnError: false,
    },
  });
  assert.equal(acted[0].error.code, 'BROWSER_REF_STALE');
  assert.match(acted[0].error.message, /no isolated-world element identity/);
  assert.equal(acted[1].ok, true);
  assert.equal(harness.applied.length, 1);

  const halted: any = await handleExtensionCommand(registry, harness.value, {
    op: 'act',
    params: { actions: [{ op: 'click', ref }, { op: 'press_key', key: 'Enter' }] },
  });
  assert.equal(halted.length, 1);
});

test('a refused page action without a code reports BROWSER_UNAVAILABLE', async () => {
  const harness = bridge({
    async apply() {
      return { ok: false };
    },
  });
  const acted: any = await handleExtensionCommand(new RefRegistry(), harness.value, {
    op: 'act',
    params: { actions: [{ op: 'press_key', key: 'Enter' }] },
  });
  assert.deepEqual(acted[0].error, {
    code: 'BROWSER_UNAVAILABLE',
    message: 'press_key did not complete in the page',
  });
});

for (const [code, pattern] of [
  ['BROWSER_INPUT_FAILED', /^Native input failed for active tab$/],
  ['BROWSER_ORIGIN_BLOCKED', /^Browser origin blocked for active tab$/],
  ['NOT_FOUND', /^Browser tab active tab was not found$/],
  ['SOMETHING_ELSE', /^click did not complete in the page$/],
] as const) {
  test(`a coordinate-only click failure with ${code} gets a native-input message`, async () => {
    const harness = bridge({
      async apply() {
        return { ok: false, code };
      },
    });
    const acted: any = await handleExtensionCommand(new RefRegistry(), harness.value, {
      op: 'act',
      params: { actions: [{ op: 'click', y: 12 }] },
    });
    assert.equal(acted[0].error.code, code);
    assert.match(acted[0].error.message, pattern);
  });
}

test('a vision capture that carries its own annotation tree scales its boxes', async () => {
  let serialized = 0;
  const harness = bridge({
    async serialize() {
      serialized += 1;
      return FIXTURE_PAGE;
    },
    async captureVisible() {
      return {
        imageDataUri: 'data:image/jpeg;base64,AAAA',
        devicePixelRatio: 2,
        annotationRoot: FIXTURE_PAGE,
      };
    },
  });
  const result: any = await handleExtensionCommand(new RefRegistry(), harness.value, {
    op: 'snapshot',
    params: { mode: 'vision' },
  });
  assert.equal(serialized, 0);
  assert.deepEqual(result.boxes, [
    { ref: 'ref_1_1', label: 'New invoice', box: { x: 20, y: 20, width: 200, height: 60 } },
  ]);

  const empty: any = await handleExtensionCommand(
    new RefRegistry(),
    bridge({
      async captureVisible() {
        return { imageDataUri: 'data:image/png;base64,AA', devicePixelRatio: 1, annotationRoot: null };
      },
    }).value,
    { op: 'snapshot', params: { mode: 'vision' } },
  );
  assert.deepEqual(empty.boxes, []);
});

test('a tab without a precomputed origin class is classified from its url', async () => {
  const result: any = await handleExtensionCommand(new RefRegistry(), bridge().value, {
    op: 'snapshot',
    params: { mode: 'a11y' },
  });
  assert.equal(result.tabId, '1');
  assert.equal(result.originClass, 'NORMAL');
});

const TREE: SnapshotElementLike = {
  tagName: 'body',
  attributes: {},
  textContent: 'top',
  children: [
    { tagName: 'p', attributes: { class: 'lead note' }, textContent: 'Lead text' } as any,
    {
      tagName: 'SECTION',
      attributes: { id: 'main' },
      textContent: undefined,
      children: [{ tagName: 'span', attributes: {}, children: [], textContent: ' inner ' }],
    } as any,
  ],
};

async function read(params: Record<string, unknown>) {
  const harness = bridge({
    async serialize() {
      return TREE;
    },
  });
  return (await handleExtensionCommand(new RefRegistry(), harness.value, {
    op: 'read',
    params,
  })) as any;
}

test('read scopes to the first element matching an id, class, or tag selector', async () => {
  assert.equal((await read({ selector: '#main' })).content, 'inner');
  assert.equal((await read({ selector: '.note' })).content, 'Lead text');
  assert.equal((await read({ selector: 'section' })).content, 'inner');
  assert.equal((await read({})).content, 'top\nLead text\ninner');
});

test('read with a selector that matches nothing fails with NOT_FOUND', async () => {
  await assert.rejects(
    read({ selector: '#missing' }),
    (error: any) => error.code === 'NOT_FOUND' && /#missing/.test(error.message),
  );
});

test('read of a tab the bridge does not list reports empty tab identity', async () => {
  const result = await read({ tabId: 'gone' });
  assert.equal(result.tabId, '');
  assert.equal(result.url, '');
});

test('read with a ref scopes to that snapshot element', async () => {
  const registry = new RefRegistry();
  const harness = bridge();
  const snap: any = await handleExtensionCommand(registry, harness.value, {
    op: 'snapshot',
    params: { mode: 'a11y' },
  });
  const heading = snap.nodes.find((node: any) => node.role === 'heading');
  const result: any = await handleExtensionCommand(registry, harness.value, {
    op: 'read',
    params: { ref: heading.ref },
  });
  assert.equal(result.content, 'Invoices');
  assert.equal(result.url, 'https://example.com/');
});

test('a command with no params and a focus without a tab id are handled', async () => {
  const tabs: any = await handleExtensionCommand(new RefRegistry(), bridge().value, {
    op: 'tabs',
  } as any);
  assert.equal(tabs.length, 2);
  await assert.rejects(
    handleExtensionCommand(new RefRegistry(), bridge().value, {
      op: 'tabs',
      params: { action: 'focus' },
    }),
    (error: any) => error.code === 'INVALID_ARGUMENT',
  );
});
