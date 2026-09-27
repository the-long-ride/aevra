import assert from 'node:assert/strict';
import test from 'node:test';
import type { DesktopOwner } from '../../protocol/src/desktop.js';
import { BackgroundDesktopState } from '../src/background-state.js';

const ownerA: DesktopOwner = { identity: { kind: 'oauth', key: 'one' }, surface: 'desktop.control' };
const ownerB: DesktopOwner = { identity: { kind: 'oauth', key: 'two' }, surface: 'desktop.control' };
const win = (id: string) => ({ windowId: id, processId: 7, processStartedAt: 'start' });
const host = (exe: string) =>
  ({ instance: win('host-win'), executablePath: exe }) as any;

function make(clock = { t: 0 }) {
  let sequence = 0;
  return new BackgroundDesktopState({ now: () => clock.t, id: () => `lease-${++sequence}` });
}

const code = (expected: string) => (error: any) => error.code === expected;

test('a verified host must stay the same for a leased window', () => {
  const state = make();
  const first = state.acquire(ownerA, win('w1'), 1, host('C:\\Apps\\one.exe'));
  // Same owner, same host: the lease is renewed.
  assert.equal(state.acquire(ownerA, win('w1'), 2, host('C:\\Apps\\one.exe')).windowLeaseId, first.windowLeaseId);
  assert.throws(() => state.acquire(ownerA, win('w1'), 2, host('C:\\Apps\\two.exe')), code('DESKTOP_TARGET_CHANGED'));
  assert.throws(() => state.acquire(ownerA, win('w1'), 2), code('DESKTOP_TARGET_CHANGED'));
});

test('host-wide and per-owner lease limits are enforced', () => {
  const state = make();
  for (let index = 0; index < 8; index += 1) state.acquire(ownerA, win(`a${index}`), 1);
  assert.throws(() => state.acquire(ownerA, win('a-extra'), 1), /quota exceeded/);
  for (let owner = 0; owner < 3; owner += 1) {
    const other: DesktopOwner = { identity: { kind: 'oauth', key: `o${owner}` }, surface: 'desktop.control' };
    for (let index = 0; index < 8; index += 1) state.acquire(other, win(`o${owner}-${index}`), 1);
  }
  assert.throws(() => state.acquire(ownerB, win('b0'), 1), /Host window lease limit reached/);
});

test('bind rejects unknown leases, foreign owners and oversized snapshots', () => {
  const state = make();
  const { windowLeaseId } = state.acquire(ownerA, win('w1'), 3);
  assert.throws(() => state.bind(ownerA, 'lease-missing', 's', []), code('DESKTOP_LEASE_EXPIRED'));
  assert.throws(() => state.bind(ownerB, windowLeaseId, 's', []), code('DESKTOP_LEASE_EXPIRED'));
  const nodes = Array.from({ length: 5001 }, (_, index) => ({ ref: `r${index}`, handle: `h${index}` }));
  assert.throws(() => state.bind(ownerA, windowLeaseId, 's', nodes), code('DESKTOP_PATTERN_UNSUPPORTED'));
});

test('resolve walks every staleness check before returning a handle', () => {
  const clock = { t: 0 };
  const state = make(clock);
  const { windowLeaseId } = state.acquire(ownerA, win('w1'), 3, host('C:\\Apps\\one.exe'));
  const target = { windowLeaseId, windowId: 'w1', snapshotId: 'snap', ref: 'r1' } as any;

  assert.throws(() => state.resolve(ownerB, target, 3), code('DESKTOP_LEASE_EXPIRED'));
  assert.throws(() => state.resolve(ownerA, target, 4), code('DESKTOP_REF_STALE'));
  assert.throws(() => state.resolve(ownerA, { ...target, windowId: 'w2' }, 3), code('DESKTOP_TARGET_CHANGED'));
  assert.throws(() => state.resolve(ownerA, target, 3), /Snapshot invalidated or stale/);

  // The snapshot defaults to the lease epoch; an explicit different epoch mismatches later.
  state.bind(ownerA, windowLeaseId, 'snap', [{ ref: 'r1', handle: 'h1' }], 9);
  assert.throws(() => state.resolve(ownerA, target, 3), /Snapshot helper epoch mismatch/);
  state.bind(ownerA, windowLeaseId, 'snap', [{ ref: 'r1', handle: 'h1' }]);
  assert.throws(() => state.resolve(ownerA, { ...target, ref: 'r9' }, 3), /Node reference not found/);
  const resolved = state.resolve(ownerA, target, 3);
  assert.equal(resolved.handle, 'h1');
  assert.equal(resolved.hostApplication?.executablePath, 'C:\\Apps\\one.exe');

  state.suspendLease(windowLeaseId);
  assert.throws(() => state.resolve(ownerA, target, 3), code('DESKTOP_FOCUS_CHANGED'));
  // Binding a fresh snapshot lifts the suspension.
  state.bind(ownerA, windowLeaseId, 'snap', [{ ref: 'r1', handle: 'h1' }]);
  assert.equal(state.resolve(ownerA, target, 3).handle, 'h1');
  state.invalidateSnapshot(windowLeaseId);
  assert.throws(() => state.resolve(ownerA, target, 3), /Snapshot invalidated/);
  // Unknown ids are ignored by the mutators.
  state.suspendLease('lease-missing');
  state.invalidateSnapshot('lease-missing');
});

test('resolve drops a lease that expires between prune and check', () => {
  // Each now() call advances the clock, so pruneExpired sees a live lease and
  // the explicit expiry check inside resolve sees it expired.
  const clock = { t: 0 };
  let calls = 0;
  const ticking = new BackgroundDesktopState({
    now: () => {
      calls += 1;
      return calls > 4 ? 60_000 + calls : clock.t;
    },
    id: () => 'lease-t',
  });
  const { windowLeaseId } = ticking.acquire(ownerA, win('w1'), 1);
  ticking.bind(ownerA, windowLeaseId, 'snap', [{ ref: 'r', handle: 'h' }]);
  const target = { windowLeaseId, windowId: 'w1', snapshotId: 'snap', ref: 'r' } as any;
  assert.throws(() => ticking.resolve(ownerA, target, 1), (error: any) => error.message === 'DESKTOP_LEASE_EXPIRED: Window lease expired');
  assert.equal(ticking.isWindowLeased('w1'), false);
});

test('release requires the same lease, owner and window', () => {
  const state = make();
  const { windowLeaseId } = state.acquire(ownerA, win('w1'), 1);
  assert.equal(state.release(ownerA, 'w1', 'lease-missing'), false);
  assert.equal(state.release(ownerB, 'w1', windowLeaseId), false);
  assert.equal(state.release(ownerA, 'w2', windowLeaseId), false);
  assert.equal(state.isWindowLeased('w1'), true);
  assert.equal(state.release(ownerA, 'w1', windowLeaseId), true);
  assert.equal(state.isWindowLeased('w1'), false);
  state.acquire(ownerA, win('w3'), 1);
  state.reset();
  assert.equal(state.isWindowLeased('w3'), false);
});

test('default dependencies use the wall clock and random ids', () => {
  const state = new BackgroundDesktopState();
  const lease = state.acquire(ownerA, win('w1'), 1);
  assert.match(lease.windowLeaseId, /^[0-9a-f-]{36}$/);
  assert.ok(Date.parse(lease.leaseExpiresAt) > Date.now());
});
