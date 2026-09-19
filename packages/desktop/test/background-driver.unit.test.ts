import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  executeBackgroundAction,
  mapBackgroundFailure,
  normalizeBackgroundCapability,
} from '../src/background-driver.js';
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

test('normalizeBackgroundCapability normalizes correctly', () => {
  assert.equal(normalizeBackgroundCapability({ backgroundActions: true }), true);
  assert.equal(normalizeBackgroundCapability({ backgroundActions: false }), false);
  assert.equal(normalizeBackgroundCapability({}), false);
  assert.equal(normalizeBackgroundCapability(null), false);
  assert.equal(normalizeBackgroundCapability(undefined), false);
  assert.equal(normalizeBackgroundCapability({ backgroundActions: 'true' }), false);
  assert.equal(normalizeBackgroundCapability({ backgroundActions: 1 }), false);
});

test('mapBackgroundFailure distinguishes pre-dispatch and post-dispatch uncertainty', () => {
  // Pre-dispatch preserved
  const preError = new DesktopDriverError('DESKTOP_REF_STALE', 'Ref is stale');
  assert.equal(mapBackgroundFailure(preError, false), preError);

  const genericError = new Error('Pipe broken before send');
  const mappedPre = mapBackgroundFailure(genericError, false);
  assert.equal(mappedPre instanceof DesktopDriverError, true);
  assert.equal((mappedPre as DesktopDriverError).code, 'DESKTOP_HELPER');

  // Post-dispatch structured precondition errors are preserved
  const disabledError = new DesktopDriverError('DESKTOP_ELEMENT_DISABLED', 'Element disabled');
  assert.equal(mapBackgroundFailure(disabledError, true), disabledError);

  const readOnlyError = new DesktopDriverError('DESKTOP_VALUE_READ_ONLY', 'Value read only');
  assert.equal(mapBackgroundFailure(readOnlyError, true), readOnlyError);

  const inputRefusedError = new DesktopDriverError('DESKTOP_INPUT_REFUSED', 'Password refused');
  assert.equal(mapBackgroundFailure(inputRefusedError, true), inputRefusedError);

  // Post-dispatch timeout / death maps to DESKTOP_OUTCOME_UNKNOWN
  const deadlineError = new DesktopDriverError('DESKTOP_DRIVER_DEADLINE', 'Helper timed out');
  const mappedDeadline = mapBackgroundFailure(deadlineError, true) as DesktopDriverError;
  assert.equal(mappedDeadline.code, 'DESKTOP_OUTCOME_UNKNOWN');

  const diedError = new DesktopDriverError('DESKTOP_DRIVER_DIED', 'Helper died');
  const mappedDied = mapBackgroundFailure(diedError, true) as DesktopDriverError;
  assert.equal(mappedDied.code, 'DESKTOP_OUTCOME_UNKNOWN');

  const timeoutError = new DesktopDriverError('DESKTOP_TIMEOUT', 'Driver timeout');
  const mappedTimeout = mapBackgroundFailure(timeoutError, true) as DesktopDriverError;
  assert.equal(mappedTimeout.code, 'DESKTOP_OUTCOME_UNKNOWN');

  const genericPost = mapBackgroundFailure(
    new Error('Network disconnected'),
    true,
  ) as DesktopDriverError;
  assert.equal(genericPost.code, 'DESKTOP_OUTCOME_UNKNOWN');
});

test('executeBackgroundAction rejects unsupported driver before dispatch', async () => {
  const { state, windowLeaseId } = setupTestState();
  const unsupportedDriver: DesktopDriver = {
    connect: async () => ({ capture: true, tree: true, attribution: true, input: true }),
    windows: async () => [],
    focusedWindow: async () => ({ windowId: 'win1' }),
    describe: async () => ({ window: { windowId: 'win1' }, nodes: [], truncated: false }),
    capture: async () => ({ imageDataUri: '', devicePixelRatio: 1, window: null }),
    act: async () => ({
      ok: true,
      delta: { focusChanged: false, newWindow: false, subtreeChanged: false },
    }),
    disconnect: async () => {},
  };

  await assert.rejects(
    async () => {
      await executeBackgroundAction({
        state,
        driver: unsupportedDriver,
        target: { windowId: 'win1', windowLeaseId, snapshotId: 'snap1', ref: 'ref1', op: 'invoke' },
        owner: TEST_OWNER,
        epoch: 1,
      });
    },
    (err: any) => err.code === 'DESKTOP_BACKGROUND_UNSUPPORTED',
  );

  // Snapshot must NOT be invalidated if unsupported driver check failed
  const resolved = state.resolve(
    TEST_OWNER,
    { windowId: 'win1', windowLeaseId, snapshotId: 'snap1', ref: 'ref1' },
    1,
  );
  assert.equal(resolved.handle, 'h1');
});
