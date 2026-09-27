import assert from 'node:assert/strict';
import test from 'node:test';
import type { DesktopOwner } from '../../protocol/src/desktop.js';
import {
  executeBackgroundAction,
  mapBackgroundFailure,
  normalizeBackgroundCapability,
} from '../src/background-driver.js';
import { BackgroundDesktopState } from '../src/background-state.js';
import { DesktopDriverError } from '../src/driver.js';
import { DesktopSessionRegistry } from '../src/registry.js';

const owner: DesktopOwner = { identity: { kind: 'oauth', key: 'one' }, surface: 'desktop.control' };

function fakeDriver(extra: Record<string, unknown> = {}) {
  return {
    connect: async () => ({ backgroundActions: true }),
    disconnect: async () => {
      throw new Error('teardown failed');
    },
    ...extra,
  } as any;
}

test('registry exposes epoch and status and survives a failing disconnect', async () => {
  const registry = new DesktopSessionRegistry({ createDriver: async () => fakeDriver() });
  assert.deepEqual(registry.status(), { connected: false, capabilities: null });
  assert.throws(() => registry.require(), /desktop_connect first/);
  const startEpoch = registry.epoch();
  await registry.connect();
  assert.ok(registry.epoch() > startEpoch);
  assert.deepEqual(registry.status(), {
    connected: true,
    capabilities: { backgroundActions: true },
  });

  registry.backgroundState.acquire(
    owner,
    { windowId: 'w1', processId: 1, processStartedAt: 's' },
    1,
  );
  assert.equal(registry.invalidateOwner(owner), 1);

  // Queued work enqueued before a disconnect is refused once the epoch moves.
  const queued = registry.run(async () => 'late');
  await registry.disconnect();
  await assert.rejects(queued, /epoch changed or disconnected/);
  assert.deepEqual(registry.status(), { connected: false, capabilities: null });
});

test('background capability is true only for a literal true flag', () => {
  assert.equal(normalizeBackgroundCapability({ backgroundActions: true }), true);
  assert.equal(normalizeBackgroundCapability({ backgroundActions: 'yes' }), false);
  assert.equal(normalizeBackgroundCapability(null), false);
  assert.equal(normalizeBackgroundCapability(), false);
});

test('mapBackgroundFailure keeps structured codes and wraps everything else', () => {
  const deadline = mapBackgroundFailure(
    new DesktopDriverError('DESKTOP_DRIVER_DEADLINE', 'late'),
    true,
  ) as any;
  assert.equal(deadline.code, 'DESKTOP_OUTCOME_UNKNOWN');
  const refused = new DesktopDriverError('DESKTOP_INPUT_REFUSED', 'no');
  assert.equal(mapBackgroundFailure(refused, true), refused);
  const afterPlain = mapBackgroundFailure(new Error('pipe closed'), true) as any;
  assert.deepEqual(
    [afterPlain.code, afterPlain.message],
    ['DESKTOP_OUTCOME_UNKNOWN', 'DESKTOP_OUTCOME_UNKNOWN: pipe closed'],
  );
  const afterOther = mapBackgroundFailure('odd', true) as any;
  assert.equal(
    afterOther.message,
    'DESKTOP_OUTCOME_UNKNOWN: Desktop action outcome is unknown after dispatch',
  );
  assert.equal(mapBackgroundFailure(refused, false), refused);
  const before = mapBackgroundFailure(42, false) as any;
  assert.deepEqual([before.code, before.message], ['DESKTOP_HELPER', 'DESKTOP_HELPER: 42']);
  const beforeError = mapBackgroundFailure(new Error('boom'), false) as any;
  assert.equal(beforeError.message, 'DESKTOP_HELPER: boom');
});

class ThrowingSuspendState extends BackgroundDesktopState {
  override suspendLease(): void {
    throw new Error('suspend failed');
  }
}

test('background action forwards the verified host and marks unknown state on suspend failure', async () => {
  const state = new ThrowingSuspendState({ now: () => 0, id: () => 'lease-1' });
  const hostApplication = {
    instance: { windowId: 'hw', processId: 2, processStartedAt: 's' },
    executablePath: 'C:\\Apps\\one.exe',
  } as any;
  const { windowLeaseId } = state.acquire(
    owner,
    { windowId: 'w1', processId: 1, processStartedAt: 's' },
    4,
    hostApplication,
  );
  state.bind(owner, windowLeaseId, 'snap', [{ ref: 'r1', handle: 'h1' }]);
  const seen: any[] = [];
  const driver = fakeDriver({
    backgroundAct: async (request: any) => {
      seen.push(request);
      return { ok: true, outcome: 'done', focusChanged: true, toggleState: 'on' };
    },
  });
  const result = await executeBackgroundAction({
    state,
    driver,
    owner,
    epoch: 4,
    target: {
      windowLeaseId,
      windowId: 'w1',
      snapshotId: 'snap',
      ref: 'r1',
      op: 'setValue',
      value: 'text',
    } as any,
  });
  assert.equal(seen[0].expectedHost, hostApplication);
  assert.equal(seen[0].value, 'text');
  assert.deepEqual(result, {
    ok: true,
    outcome: 'completed',
    window: { windowId: 'w1' },
    snapshotInvalidated: true,
    requiresDescribe: true,
    focusChanged: true,
    postActionStateUnknown: true,
    toggleState: 'on',
  });
});
