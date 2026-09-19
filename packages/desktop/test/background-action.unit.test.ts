import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executeBackgroundAction } from '../src/background-driver.js';
import { BackgroundDesktopState } from '../src/background-state.js';
import { DesktopDriverError, type DesktopDriver } from '../src/driver.js';
import type { DesktopOwner } from '../../protocol/src/desktop.js';

const TEST_OWNER: DesktopOwner = { sessionId: 's1', workspaceId: 'w1' };
const TEST_WINDOW = { windowId: 'win1', processId: 100, processStartedAt: '2026-09-18T00:00:00Z' };

function setupTestState() {
  const state = new BackgroundDesktopState({ now: () => 1000, id: () => 'lease1' });
  const { windowLeaseId } = state.acquire(TEST_OWNER, TEST_WINDOW, 1);
  state.bind(
    TEST_OWNER,
    windowLeaseId,
    'snap1',
    [
      { ref: 'ref1', handle: 'h1' },
      { ref: 'ref2', handle: 'h2' },
      { ref: 'ref3', handle: 'h3' },
      { ref: 'ref4', handle: 'h4' },
    ],
    1,
  );
  return { state, windowLeaseId };
}

test('executeBackgroundAction dispatches invoke, setValue, select, toggle and invalidates snapshot', async () => {
  for (const op of ['invoke', 'setValue', 'select', 'toggle'] as const) {
    const { state, windowLeaseId } = setupTestState();
    let dispatchedCall: unknown = null;

    const mockDriver: DesktopDriver = {
      connect: async () => ({
        capture: true,
        tree: true,
        attribution: true,
        input: true,
        backgroundActions: true,
      }),
      windows: async () => [],
      focusedWindow: async () => ({ windowId: 'win1' }),
      describe: async () => ({ window: { windowId: 'win1' }, nodes: [], truncated: false }),
      capture: async () => ({ imageDataUri: '', devicePixelRatio: 1, window: null }),
      act: async () => ({
        ok: true,
        delta: { focusChanged: false, newWindow: false, subtreeChanged: false },
      }),
      disconnect: async () => {},
      backgroundAct: async (req) => {
        dispatchedCall = req;
        return {
          ok: true,
          outcome: 'completed',
          focusChanged: false,
          toggleState: op === 'toggle' ? 'on' : undefined,
        };
      },
    };

    const target =
      op === 'setValue'
        ? {
            windowId: 'win1',
            windowLeaseId,
            snapshotId: 'snap1',
            ref: 'ref1',
            op: 'setValue' as const,
            value: 'hello',
          }
        : { windowId: 'win1', windowLeaseId, snapshotId: 'snap1', ref: 'ref1', op };

    const result = await executeBackgroundAction({
      state,
      driver: mockDriver,
      target,
      owner: TEST_OWNER,
      epoch: 1,
    });

    assert.equal(result.ok, true);
    assert.equal(result.outcome, 'completed');
    assert.equal(result.snapshotInvalidated, true);
    assert.equal(result.requiresDescribe, true);
    assert.equal(result.focusChanged, false);
    if (op === 'toggle') {
      assert.equal(result.toggleState, 'on');
    }

    assert.deepEqual(dispatchedCall, {
      snapshotId: 'snap1',
      handle: 'h1',
      op,
      value: op === 'setValue' ? 'hello' : undefined,
      expectedInstance: {
        windowId: 'win1',
        processId: 100,
        processStartedAt: '2026-09-18T00:00:00Z',
      },
    });

    // Verify snapshot was invalidated
    assert.throws(
      () =>
        state.resolve(
          TEST_OWNER,
          { windowId: 'win1', windowLeaseId, snapshotId: 'snap1', ref: 'ref1' },
          1,
        ),
      (err: any) => err.code === 'DESKTOP_REF_STALE',
    );
  }
});

test('executeBackgroundAction maps driver timeout after dispatch to DESKTOP_OUTCOME_UNKNOWN and invalidates snapshot', async () => {
  const { state, windowLeaseId } = setupTestState();
  let dispatchCount = 0;

  const hangingDriver: DesktopDriver = {
    connect: async () => ({
      capture: true,
      tree: true,
      attribution: true,
      input: true,
      backgroundActions: true,
    }),
    windows: async () => [],
    focusedWindow: async () => ({ windowId: 'win1' }),
    describe: async () => ({ window: { windowId: 'win1' }, nodes: [], truncated: false }),
    capture: async () => ({ imageDataUri: '', devicePixelRatio: 1, window: null }),
    act: async () => ({
      ok: true,
      delta: { focusChanged: false, newWindow: false, subtreeChanged: false },
    }),
    disconnect: async () => {},
    backgroundAct: async () => {
      dispatchCount++;
      throw new DesktopDriverError(
        'DESKTOP_DRIVER_DEADLINE',
        'Helper call timed out: backgroundAct',
      );
    },
  };

  await assert.rejects(
    async () => {
      await executeBackgroundAction({
        state,
        driver: hangingDriver,
        target: { windowId: 'win1', windowLeaseId, snapshotId: 'snap1', ref: 'ref1', op: 'invoke' },
        owner: TEST_OWNER,
        epoch: 1,
      });
    },
    (err: any) => err.code === 'DESKTOP_OUTCOME_UNKNOWN',
  );

  assert.equal(dispatchCount, 1);
  // Snapshot MUST be invalidated because dispatch occurred
  assert.throws(
    () =>
      state.resolve(
        TEST_OWNER,
        { windowId: 'win1', windowLeaseId, snapshotId: 'snap1', ref: 'ref1' },
        1,
      ),
    (err: any) => err.code === 'DESKTOP_REF_STALE',
  );
});

test('executeBackgroundAction preserves structured precondition error and invalidates snapshot', async () => {
  const { state, windowLeaseId } = setupTestState();
  let dispatchCount = 0;

  const rejectingDriver: DesktopDriver = {
    connect: async () => ({
      capture: true,
      tree: true,
      attribution: true,
      input: true,
      backgroundActions: true,
    }),
    windows: async () => [],
    focusedWindow: async () => ({ windowId: 'win1' }),
    describe: async () => ({ window: { windowId: 'win1' }, nodes: [], truncated: false }),
    capture: async () => ({ imageDataUri: '', devicePixelRatio: 1, window: null }),
    act: async () => ({
      ok: true,
      delta: { focusChanged: false, newWindow: false, subtreeChanged: false },
    }),
    disconnect: async () => {},
    backgroundAct: async () => {
      dispatchCount++;
      throw new DesktopDriverError('DESKTOP_ELEMENT_DISABLED', 'Target element is disabled');
    },
  };

  await assert.rejects(
    async () => {
      await executeBackgroundAction({
        state,
        driver: rejectingDriver,
        target: { windowId: 'win1', windowLeaseId, snapshotId: 'snap1', ref: 'ref1', op: 'invoke' },
        owner: TEST_OWNER,
        epoch: 1,
      });
    },
    (err: any) => err.code === 'DESKTOP_ELEMENT_DISABLED',
  );

  assert.equal(dispatchCount, 1);
  assert.throws(
    () =>
      state.resolve(
        TEST_OWNER,
        { windowId: 'win1', windowLeaseId, snapshotId: 'snap1', ref: 'ref1' },
        1,
      ),
    (err: any) => err.code === 'DESKTOP_REF_STALE',
  );
});

test('executeBackgroundAction suspends lease on observed focus change and refuses subsequent actions', async () => {
  const { state, windowLeaseId } = setupTestState();

  const focusChangingDriver: DesktopDriver = {
    connect: async () => ({
      capture: true,
      tree: true,
      attribution: true,
      input: true,
      backgroundActions: true,
    }),
    windows: async () => [],
    focusedWindow: async () => ({ windowId: 'win1' }),
    describe: async () => ({ window: { windowId: 'win1' }, nodes: [], truncated: false }),
    capture: async () => ({ imageDataUri: '', devicePixelRatio: 1, window: null }),
    act: async () => ({
      ok: true,
      delta: { focusChanged: false, newWindow: false, subtreeChanged: false },
    }),
    disconnect: async () => {},
    backgroundAct: async () => ({
      ok: true,
      outcome: 'completed',
      focusChanged: true,
    }),
  };

  const result = await executeBackgroundAction({
    state,
    driver: focusChangingDriver,
    target: { windowId: 'win1', windowLeaseId, snapshotId: 'snap1', ref: 'ref1', op: 'invoke' },
    owner: TEST_OWNER,
    epoch: 1,
  });

  assert.equal(result.ok, true);
  assert.equal(result.focusChanged, true);

  // Attempting another action on this lease without fresh describe throws DESKTOP_FOCUS_CHANGED
  assert.throws(
    () =>
      state.resolve(
        TEST_OWNER,
        { windowId: 'win1', windowLeaseId, snapshotId: 'snap2', ref: 'ref2' },
        1,
      ),
    (err: any) => err.code === 'DESKTOP_FOCUS_CHANGED',
  );

  // Fresh describe binds a new snapshot and unsuspends the lease
  state.bind(TEST_OWNER, windowLeaseId, 'snap2', [{ ref: 'ref2', handle: 'h2' }], 1);
  const resolved = state.resolve(
    TEST_OWNER,
    { windowId: 'win1', windowLeaseId, snapshotId: 'snap2', ref: 'ref2' },
    1,
  );
  assert.equal(resolved.handle, 'h2');
});

test('executeBackgroundAction preserves completed result when post-action sampling has postActionStateUnknown', async () => {
  const { state, windowLeaseId } = setupTestState();

  const partialDriver: DesktopDriver = {
    connect: async () => ({
      capture: true,
      tree: true,
      attribution: true,
      input: true,
      backgroundActions: true,
    }),
    windows: async () => [],
    focusedWindow: async () => ({ windowId: 'win1' }),
    describe: async () => ({ window: { windowId: 'win1' }, nodes: [], truncated: false }),
    capture: async () => ({ imageDataUri: '', devicePixelRatio: 1, window: null }),
    act: async () => ({
      ok: true,
      delta: { focusChanged: false, newWindow: false, subtreeChanged: false },
    }),
    disconnect: async () => {},
    backgroundAct: async () => ({
      ok: true,
      outcome: 'completed',
      focusChanged: false,
      postActionStateUnknown: true,
    }),
  };

  const result = await executeBackgroundAction({
    state,
    driver: partialDriver,
    target: { windowId: 'win1', windowLeaseId, snapshotId: 'snap1', ref: 'ref1', op: 'invoke' },
    owner: TEST_OWNER,
    epoch: 1,
  });

  assert.equal(result.ok, true);
  assert.equal(result.outcome, 'completed');
  assert.equal(result.postActionStateUnknown, true);
});
