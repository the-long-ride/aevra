import assert from 'node:assert/strict';
import test from 'node:test';
import type { ControlAction } from '../../protocol/src/control.js';
import { McpBrowserControlAdapter, McpDesktopControlAdapter } from '../src/control-adapters.js';

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

// ---------------------------------------------------------------- desktop

const desktopDescribe = {
  snapshotId: 'snap-1',
  windowLeaseId: 'lease-1',
  truncated: false,
  nodes: [
    {
      ref: 'd1',
      role: 'checkbox',
      name: 'Wrap',
      enabled: true,
      toggleState: 'off',
      supportedActions: ['toggle', 'invoke', 'scroll'],
      children: [
        {
          ref: 'd2',
          role: 'edit',
          name: 'Name',
          value: 'old',
          enabled: true,
          supportedActions: ['setValue', 'select'],
        },
      ],
    },
  ],
};

test('desktop adapter refuses isolated mode and describes its capabilities', () => {
  const { value } = context(() => ({}));
  assert.throws(
    () => new McpDesktopControlAdapter(value, 's', 'w1', 'isolated'),
    code('CONTROL_ISOLATION_UNAVAILABLE'),
  );
  const adapter = new McpDesktopControlAdapter(value, 's', 'w1', 'sharedSemantic');
  assert.equal(adapter.surfaceId, 'desktop:w1');
  assert.equal(adapter.capabilities().capture, false);
});

test('desktop observe maps provider actions and requires a snapshot lease', async () => {
  let reply: unknown = desktopDescribe;
  const { value, calls } = context(() => reply, null);
  const adapter = new McpDesktopControlAdapter(value, 's', 'w1', 'sharedSemantic', 25);

  const observation = await adapter.observe();
  assert.deepEqual(calls[0], {
    tool: 'desktop_describe',
    args: { windowId: 'w1', mode: 'background', maxNodes: 25, interactiveOnly: false },
  });
  const [box] = observation.nodes;
  assert.deepEqual(box?.actions, ['setToggleState', 'invoke', 'click']);
  assert.equal(box?.toggleState, 'off');
  assert.deepEqual(box?.children?.[0]?.actions, ['setValue', 'type', 'select']);
  assert.equal(box?.children?.[0]?.value, 'old');
  assert.equal(box?.children?.[0]?.parentRef, 'd1');
  assert.equal((await adapter.observe()).observationId, observation.observationId);

  reply = { nodes: [], windowLeaseId: 'lease-2' };
  await assert.rejects(adapter.observe(), code('CONTROL_DESKTOP_OBSERVE_FAILED'));
  reply = { snapshotId: 'snap-3', windowLeaseId: 'lease-3', truncated: true };
  const empty = await adapter.observe();
  assert.deepEqual(empty.nodes, []);
  assert.equal(empty.coverage.truncated, true);
});

/** Desktop providers return flat node lists; dispatch looks refs up at the top level. */
const flatDescribe = {
  ...desktopDescribe,
  nodes: [
    { ...desktopDescribe.nodes[0]!, children: undefined },
    desktopDescribe.nodes[0]!.children[0]!,
  ],
};

async function observedDesktop(reply: Reply) {
  const { value, calls } = context((tool, args) =>
    tool === 'desktop_describe' ? flatDescribe : reply(tool, args),
  );
  const adapter = new McpDesktopControlAdapter(value, 's', 'w1', 'sharedSemantic');
  await adapter.observe();
  return { adapter, calls };
}

test('desktop dispatch maps each action to its semantic provider tool', async () => {
  const cases: Array<[string, ControlAction, string, Record<string, unknown>]> = [
    ['d1', { op: 'invoke' }, 'desktop_invoke', {}],
    ['d1', { op: 'click' }, 'desktop_invoke', {}],
    ['d2', { op: 'setValue', value: 'new' }, 'desktop_set_value', { value: 'new' }],
    ['d2', { op: 'type', text: 'typed' }, 'desktop_set_value', { value: 'typed' }],
    ['d2', { op: 'select', value: 'x' }, 'desktop_select', {}],
    ['d1', { op: 'setToggleState', state: 'on' }, 'desktop_toggle', {}],
  ];
  for (const [ref, action, tool, extra] of cases) {
    const { adapter, calls } = await observedDesktop(() => ({ ok: true }));
    const receipt = await adapter.dispatch({ ref }, action, 100);
    assert.deepEqual(receipt, { dispatched: true, outcome: 'completed' });
    assert.deepEqual(calls.at(-1), {
      tool,
      args: {
        workspaceId: 'ws-1',
        windowId: 'w1',
        windowLeaseId: 'lease-1',
        snapshotId: 'snap-1',
        ref,
        ...extra,
      },
    });
    await assert.rejects(adapter.dispatch({ ref }, action, 100), code('CONTROL_OBSERVATION_STALE'));
  }
});

test('desktop dispatch short-circuits waits and already-satisfied toggles', async () => {
  const { adapter, calls } = await observedDesktop(() => ({ ok: true }));
  const before = calls.length;
  assert.equal(
    (await adapter.dispatch({ ref: 'd1' }, { op: 'wait_for', timeoutMs: 10 }, 10)).outcome,
    'alreadySatisfied',
  );
  assert.equal(
    (await adapter.dispatch({ ref: 'd1' }, { op: 'setToggleState', state: 'off' }, 10)).outcome,
    'alreadySatisfied',
  );
  assert.equal(calls.length, before);
});

test('desktop dispatch rejects invalid targets and unsupported actions', async () => {
  const { value } = context(() => desktopDescribe);
  const fresh = new McpDesktopControlAdapter(value, 's', 'w1', 'sharedSemantic');
  const locator = {
    locator: { scope: 'surface', role: 'button', name: 'Go', match: 'exact', requireUnique: true },
  } as const;
  await assert.rejects(
    fresh.dispatch(locator, { op: 'click' }, 10),
    code('CONTROL_TARGET_INVALID'),
  );
  await assert.rejects(
    fresh.dispatch({ ref: 'd1' }, { op: 'click' }, 10),
    code('CONTROL_OBSERVATION_STALE'),
  );

  const { adapter } = await observedDesktop(() => ({ ok: true }));
  await assert.rejects(
    adapter.dispatch({ ref: 'zz' }, { op: 'click' }, 10),
    code('CONTROL_REF_STALE'),
  );
  await assert.rejects(
    adapter.dispatch({ ref: 'd1' }, { op: 'press_key', key: 'A' }, 10),
    code('CONTROL_ACTION_UNSUPPORTED'),
  );
});

test('desktop dispatch classifies approvals, unknown outcomes, focus loss, and provider errors', async () => {
  const cases: Array<[Reply, string, string]> = [
    [
      () => ({ status: 'approval_pending', requestId: 'r1' }),
      'CONTROL_APPROVAL_REQUIRED',
      'notDispatched',
    ],
    [() => ({ postActionStateUnknown: true }), 'CONTROL_OUTCOME_UNKNOWN', 'unknown'],
    [() => ({ focusChanged: true }), 'CONTROL_CONTEXT_CHANGED', 'dispatched'],
    [
      () => {
        throw Object.assign(new Error('lost'), { code: 'DESKTOP_OUTCOME_UNKNOWN' });
      },
      'DESKTOP_OUTCOME_UNKNOWN',
      'unknown',
    ],
    [
      () => {
        throw Object.assign(new Error('nope'), { code: 'DESKTOP_DENIED' });
      },
      'DESKTOP_DENIED',
      'notDispatched',
    ],
    [
      () => {
        throw 'plain failure';
      },
      'CONTROL_DESKTOP_DISPATCH_FAILED',
      'notDispatched',
    ],
  ];
  for (const [reply, expectedCode, dispatchState] of cases) {
    const { adapter } = await observedDesktop(reply);
    await assert.rejects(
      adapter.dispatch({ ref: 'd1' }, { op: 'click' }, 10),
      (error: any) => error.code === expectedCode && error.dispatchState === dispatchState,
      expectedCode,
    );
  }
});
