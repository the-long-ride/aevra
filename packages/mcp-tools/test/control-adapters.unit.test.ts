import assert from 'node:assert/strict';
import test from 'node:test';
import type { ControlAction } from '../../protocol/src/control.js';
import { McpBrowserControlAdapter } from '../src/control-adapters.js';

type Reply = (tool: string, args: any) => unknown;

function context(reply: Reply, workspaceId: string | null = 'ws-1') {
  const calls: Array<{ tool: string; args: any }> = [];
  const value = {
    ...(workspaceId ? { workspaceId } : {}),
    async callInner(_sessionId: string, tool: string, args: any) {
      calls.push({ tool, args });
      return reply(tool, args);
    },
  };
  return { calls, value: value as any };
}

const code = (expected: string) => (error: any) => error?.code === expected;

// ---------------------------------------------------------------- browser

const browserSnapshot = {
  tabId: 't1',
  url: 'https://example.test/',
  snapshotVersion: 1,
  truncated: true,
  nodes: [
    {
      ref: 'e1',
      role: 'combobox',
      name: 'Colour',
      value: 'red',
      children: [{ ref: 'e2', role: 'option', name: 'Blue', disabled: true }],
    },
    { ref: 'e3', role: 'button', name: 'Save' },
  ],
};

test('browser adapter refuses isolated mode and describes its capabilities', () => {
  const { value } = context(() => ({}));
  assert.throws(
    () => new McpBrowserControlAdapter(value, 's', 't1', 'isolated'),
    code('CONTROL_ISOLATION_UNAVAILABLE'),
  );
  const adapter = new McpBrowserControlAdapter(value, 's', undefined, 'sharedSemantic');
  assert.equal(adapter.surfaceId, 'browser:active');
  assert.equal(adapter.capabilities().capture, true);
});

test('browser observe maps nodes, caches unchanged snapshots, and bumps generation', async () => {
  let snapshot: any = browserSnapshot;
  const { value, calls } = context(() => snapshot);
  const adapter = new McpBrowserControlAdapter(value, 's', undefined, 'sharedSemantic', 50);

  const first = await adapter.observe();
  assert.equal(adapter.surfaceId, 'browser:t1');
  assert.deepEqual(calls[0], {
    tool: 'browser_snapshot',
    args: { workspaceId: 'ws-1', mode: 'a11y', maxNodes: 50 },
  });
  assert.equal(first.coverage.truncated, true);
  assert.equal(first.url, 'https://example.test/');
  const [combo, save] = first.nodes;
  assert.deepEqual(combo?.actions, ['wait_for', 'click', 'type', 'select']);
  assert.equal(combo?.value, 'red');
  assert.deepEqual(combo?.children?.[0]?.actions, ['wait_for']);
  assert.equal(combo?.children?.[0]?.parentRef, 'e1');
  assert.equal(combo?.children?.[0]?.enabled, false);
  assert.deepEqual(save?.actions, ['wait_for', 'click']);
  assert.equal('value' in save!, false);

  const cached = await adapter.observe();
  assert.equal(cached.observationId, first.observationId);
  assert.equal(calls[1]?.args.tabId, 't1');

  snapshot = { ...browserSnapshot, snapshotVersion: 2 };
  const next = await adapter.observe();
  assert.notEqual(next.observationId, first.observationId);
  assert.equal(next.generation, 2);

  snapshot = { nodes: [] };
  const unversioned = await adapter.observe();
  assert.equal(unversioned.generation, 2);
  assert.equal(unversioned.url, '');
});

test('browser observe fails without a tab id', async () => {
  const { value } = context(() => ({ nodes: [] }), null);
  const adapter = new McpBrowserControlAdapter(value, 's', undefined, 'sharedSemantic');
  await assert.rejects(adapter.observe(), code('CONTROL_BROWSER_OBSERVE_FAILED'));
});

test('browser dispatch translates every control action into one browser action', async () => {
  const { value, calls } = context(() => [{ ok: true }]);
  const adapter = new McpBrowserControlAdapter(value, 's', 't1', 'sharedSemantic');
  const cases: Array<[ControlAction, unknown]> = [
    [{ op: 'click' }, { op: 'click', ref: 'e1' }],
    [{ op: 'invoke' }, { op: 'click', ref: 'e1' }],
    [
      { op: 'type', text: 'hi', clear: true },
      { op: 'type', ref: 'e1', text: 'hi', clear: true },
    ],
    [
      { op: 'setValue', value: 'v' },
      { op: 'type', ref: 'e1', text: 'v', clear: true },
    ],
    [
      { op: 'press_key', key: 'Enter' },
      { op: 'press_key', key: 'Enter' },
    ],
    [
      { op: 'scroll', dx: 1, dy: 2 },
      { op: 'scroll', ref: 'e1', dx: 1, dy: 2 },
    ],
    [
      { op: 'select', value: 'Blue' },
      { op: 'select', ref: 'e1', value: 'Blue' },
    ],
    [
      { op: 'wait_for', text: 'Done', timeoutMs: 9_000 },
      { op: 'wait_for', ref: 'e1', text: 'Done', timeoutMs: 500 },
    ],
  ];
  for (const [action, expected] of cases) {
    const receipt = await adapter.dispatch({ ref: 'e1' }, action, 500);
    assert.deepEqual(calls.at(-1), {
      tool: 'browser_act_many',
      args: { workspaceId: 'ws-1', tabId: 't1', actions: [expected], stopOnError: true },
    });
    assert.equal(receipt.dispatched, action.op !== 'wait_for');
  }
});

test('browser dispatch rejects locators, unsupported actions, approvals, and failures', async () => {
  let reply: unknown = [{ ok: true }];
  const { value } = context(() => reply);
  const adapter = new McpBrowserControlAdapter(value, 's', undefined, 'sharedSemantic');
  const locator = {
    locator: {
      scope: 'surface',
      role: 'button',
      name: 'Save',
      match: 'exact',
      requireUnique: true,
    },
  } as const;
  await assert.rejects(
    adapter.dispatch(locator, { op: 'click' }, 100),
    code('CONTROL_TARGET_INVALID'),
  );
  await assert.rejects(
    adapter.dispatch({ ref: 'e1' }, { op: 'setToggleState', state: 'on' }, 100),
    code('CONTROL_ACTION_UNSUPPORTED'),
  );

  reply = { status: 'approval_pending', requestId: 'req_9' };
  await assert.rejects(
    adapter.dispatch({ ref: 'e1' }, { op: 'click' }, 100),
    (error: any) => error.code === 'CONTROL_APPROVAL_REQUIRED' && /req_9/.test(error.message),
  );
  reply = { status: 'approval_pending' };
  await assert.rejects(
    adapter.dispatch({ ref: 'e1' }, { op: 'click' }, 100),
    code('CONTROL_APPROVAL_REQUIRED'),
  );

  reply = [{ ok: false, error: { code: 'BROWSER_GONE', message: 'tab closed' } }];
  await assert.rejects(adapter.dispatch({ ref: 'e1' }, { op: 'click' }, 100), code('BROWSER_GONE'));
  reply = { result: [{ ok: false, detail: 'blocked' }] };
  await assert.rejects(
    adapter.dispatch({ ref: 'e1' }, { op: 'click' }, 100),
    (error: any) =>
      error.code === 'CONTROL_BROWSER_DISPATCH_FAILED' && /blocked/.test(error.message),
  );
  reply = { 0: { ok: false } };
  await assert.rejects(adapter.dispatch({ ref: 'e1' }, { op: 'click' }, 100), (error: any) =>
    /Browser action failed/.test(error.message),
  );
  reply = { result: [] };
  assert.equal((await adapter.dispatch({ ref: 'e1' }, { op: 'click' }, 100)).dispatched, true);
});
