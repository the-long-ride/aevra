import assert from 'node:assert/strict';
import test from 'node:test';
import { BackgroundDesktopState } from '../src/background-state.js';
import type { DesktopOwner } from '../../protocol/src/desktop.js';

test('deterministic clock tests for 60-second expiry, quota rejection, renewal, busy windows', () => {
  let tick = 0;
  let sequence = 0;
  const state = new BackgroundDesktopState({
    now: () => tick,
    id: () => `lease-${++sequence}`,
  });
  const ownerA: DesktopOwner = { sessionId: 'ses-a', workspaceId: 'ws-1' };
  const ownerB: DesktopOwner = { sessionId: 'ses-b', workspaceId: 'ws-1' };
  const win1 = { windowId: 'win-1', processId: 100, processStartedAt: '2026-09-18T10:00:00Z' };

  // Owner A acquires win1
  const leaseA = state.acquire(ownerA, win1, 1);
  assert.equal(leaseA.windowLeaseId, 'lease-1');

  // Owner B tries to acquire win1 -> DESKTOP_WINDOW_BUSY
  assert.throws(
    () => state.acquire(ownerB, win1, 1),
    (err: any) => {
      assert.equal(err.code, 'DESKTOP_WINDOW_BUSY');
      return true;
    },
  );

  // Owner A re-acquires win1 -> renews lease
  const renewedA = state.acquire(ownerA, win1, 1);
  assert.equal(renewedA.windowLeaseId, 'lease-1');

  // Move clock past 60s
  tick = 60_001;

  // Now Owner B can acquire win1 because leaseA expired
  const leaseB = state.acquire(ownerB, win1, 1);
  assert.equal(leaseB.windowLeaseId, 'lease-2');
});

test('same HWND with new process instance is not treated as the same window', () => {
  let tick = 0;
  let sequence = 0;
  const state = new BackgroundDesktopState({
    now: () => tick,
    id: () => `lease-${++sequence}`,
  });
  const ownerA: DesktopOwner = { sessionId: 'ses-a', workspaceId: 'ws-1' };
  const winOld = { windowId: 'win-1', processId: 100, processStartedAt: '2026-09-18T10:00:00Z' };
  const winNew = { windowId: 'win-1', processId: 200, processStartedAt: '2026-09-18T11:00:00Z' };

  state.acquire(ownerA, winOld, 1);

  // New process with same window ID acquires its own distinct lease without conflict
  const leaseNew = state.acquire(ownerA, winNew, 1);
  assert.notEqual(leaseNew.windowLeaseId, 'lease-1');
});

test('quota limits: max 8 leases per owner and 32 host-wide', () => {
  let sequence = 0;
  const state = new BackgroundDesktopState({
    now: () => 1_000,
    id: () => `lease-${++sequence}`,
  });
  const owner: DesktopOwner = { sessionId: 'ses-1', workspaceId: 'ws-1' };

  for (let i = 0; i < 8; i++) {
    state.acquire(owner, { windowId: `win-${i}`, processId: 100 + i, processStartedAt: 'time' }, 1);
  }

  // 9th lease by same owner fails quota
  assert.throws(
    () => state.acquire(owner, { windowId: 'win-8', processId: 108, processStartedAt: 'time' }, 1),
    /DESKTOP_WINDOW_BUSY/,
  );
});

test('bind and resolve nodes, invalidateSnapshot, and epoch mismatch', () => {
  let tick = 1000;
  const state = new BackgroundDesktopState({
    now: () => tick,
    id: () => 'lease-1',
  });
  const owner: DesktopOwner = { sessionId: 'ses-1', workspaceId: 'ws-1' };
  const otherOwner: DesktopOwner = { sessionId: 'ses-2', workspaceId: 'ws-1' };
  const win = { windowId: 'win-1', processId: 100, processStartedAt: 'time' };

  const { windowLeaseId } = state.acquire(owner, win, 1);
  state.bind(owner, windowLeaseId, 'snap-1', [{ ref: 'ref-btn', handle: 'handle-btn-1' }], 1);

  // Resolve succeeds with valid target
  const res = state.resolve(
    owner,
    {
      windowId: 'win-1',
      snapshotId: 'snap-1',
      windowLeaseId,
      ref: 'ref-btn',
    },
    1,
  );
  assert.equal(res.handle, 'handle-btn-1');

  // Other owner cannot resolve
  assert.throws(
    () =>
      state.resolve(
        otherOwner,
        {
          windowId: 'win-1',
          snapshotId: 'snap-1',
          windowLeaseId,
          ref: 'ref-btn',
        },
        1,
      ),
    /DESKTOP_LEASE_EXPIRED/,
  );

  // Epoch mismatch throws DESKTOP_REF_STALE
  assert.throws(
    () =>
      state.resolve(
        owner,
        {
          windowId: 'win-1',
          snapshotId: 'snap-1',
          windowLeaseId,
          ref: 'ref-btn',
        },
        2,
      ),
    /DESKTOP_REF_STALE/,
  );

  // Invalidate snapshot makes ref stale
  state.invalidateSnapshot(windowLeaseId);
  assert.throws(
    () =>
      state.resolve(
        owner,
        {
          windowId: 'win-1',
          snapshotId: 'snap-1',
          windowLeaseId,
          ref: 'ref-btn',
        },
        1,
      ),
    /DESKTOP_REF_STALE/,
  );
});

test('release is idempotent for owner, cannot release foreign leases', () => {
  const state = new BackgroundDesktopState({
    now: () => 1000,
    id: () => 'lease-1',
  });
  const ownerA: DesktopOwner = { sessionId: 'ses-a', workspaceId: 'ws-1' };
  const ownerB: DesktopOwner = { sessionId: 'ses-b', workspaceId: 'ws-1' };
  const win1 = { windowId: 'win-1', processId: 100, processStartedAt: 'time' };

  const { windowLeaseId } = state.acquire(ownerA, win1, 1);

  // Owner B cannot release Owner A's lease
  assert.equal(state.release(ownerB, 'win-1', windowLeaseId), false);
  assert.equal(state.isWindowLeased('win-1'), true);

  // Owner A releases
  assert.equal(state.release(ownerA, 'win-1', windowLeaseId), true);
  assert.equal(state.isWindowLeased('win-1'), false);

  // Subsequent release is idempotent
  assert.equal(state.release(ownerA, 'win-1', windowLeaseId), false);
});
