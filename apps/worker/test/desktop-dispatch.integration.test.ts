import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { DesktopSessionRegistry } from '../../../packages/desktop/src/registry.js';
import { FakeDesktopDriver } from '../../../packages/desktop/test/fake-driver.js';
import { dispatchDesktopOperation } from '../src/desktop-dispatch.js';
import { DesktopRuntime, resolveHelperBinaryPath } from '../src/desktop-runtime.js';

const allowAll = {
  mode: 'denylist' as const,
  applications: [],
  unattributedInput: 'deny' as const,
};

async function connected() {
  const driver = new FakeDesktopDriver({
    capture: true,
    tree: true,
    attribution: true,
    input: true,
  });
  const registry = new DesktopSessionRegistry({ createDriver: async () => driver });
  await registry.connect();
  return { registry, driver };
}

test('a permitted click reaches the driver', async () => {
  const { registry } = await connected();
  await dispatchDesktopOperation(
    { kind: 'desktop.describe', maxNodes: 10, interactiveOnly: true },
    registry,
  );
  const result = await dispatchDesktopOperation(
    { kind: 'desktop.act', op: 'click', ref: 'ref_1_1', policy: allowAll },
    registry,
  );
  assert.equal((result as { ok: boolean }).ok, true);
});

test('a denylisted window refuses input with DESKTOP_INPUT_REFUSED', async () => {
  const { registry } = await connected();
  await dispatchDesktopOperation(
    { kind: 'desktop.describe', maxNodes: 10, interactiveOnly: true },
    registry,
  );
  await assert.rejects(
    () =>
      dispatchDesktopOperation(
        {
          kind: 'desktop.act',
          op: 'click',
          ref: 'ref_1_1',
          policy: { mode: 'denylist', applications: ['notepad.exe'], unattributedInput: 'deny' },
        },
        registry,
      ),
    /DESKTOP_INPUT_REFUSED/,
  );
});

test('capture is never refused by policy', async () => {
  const { registry } = await connected();
  const shot = await dispatchDesktopOperation({ kind: 'desktop.capture' }, registry);
  assert.match((shot as { imageDataUri: string }).imageDataUri, /^data:image\//);
});

// The runtime singleton is real production code: Task 9a wired it to a real
// HelperProcess/WindowsDesktopDriver over the compiled Rust helper. This
// pins the OTHER deliberate failure mode -- the binary is simply not there
// -- which now gets its own code, DESKTOP_HELPER_NOT_INSTALLED, distinct
// from DESKTOP_DRIVER_DIED ("it started and then died"). The override is
// forced to a path that cannot exist and the default locations are emptied,
// so this stays deterministic regardless of what a developer has built
// locally (a stale override now falls back to those defaults).
test('desktopRuntime.registry() connect() rejects with DESKTOP_HELPER_NOT_INSTALLED when the binary cannot be found', async () => {
  const missing = fileURLToPath(new URL('./does-not-exist.exe', import.meta.url));
  const runtime = new DesktopRuntime(() =>
    resolveHelperBinaryPath({
      env: { AEVRA_DESKTOP_HELPER_PATH: missing },
      candidates: [],
      warn: () => {},
    }),
  );
  await assert.rejects(() => runtime.registry().connect(), /DESKTOP_HELPER_NOT_INSTALLED/);
});

test('desktop.apps resolves without a connected session', async () => {
  const registry = new DesktopSessionRegistry({
    createDriver: async () => {
      throw new Error('desktop.apps must never need a driver');
    },
  });
  const apps = await dispatchDesktopOperation({ kind: 'desktop.apps' }, registry);
  assert.ok(Array.isArray(apps));
});

const ownerA = {
  identity: { kind: 'oauth' as const, key: 'connection-A' },
  surface: 'desktop.control' as const,
};
const ownerB = {
  identity: { kind: 'oauth' as const, key: 'connection-B' },
  surface: 'desktop.control' as const,
};

test('background describe acquires lease and returns snapshot info', async () => {
  const { registry } = await connected();
  const desc = (await dispatchDesktopOperation(
    {
      kind: 'desktop.describe',
      mode: 'background',
      windowId: 'w1',
      maxNodes: 10,
      interactiveOnly: true,
      policy: allowAll,
    },
    registry,
    ownerA,
  )) as any;

  assert.equal(desc.window.windowId, 'w1');
  assert.ok(desc.snapshotId);
  assert.ok(desc.windowLeaseId);
  assert.ok(desc.leaseExpiresAt);
  assert.equal(desc.nodes.length, 1);
  assert.equal(desc.nodes[0].ref, 'ref_1_1');
});

test('desktop owner invalidation expires outstanding background leases', async () => {
  const { registry } = await connected();
  const desc = (await dispatchDesktopOperation(
    {
      kind: 'desktop.describe',
      mode: 'background',
      windowId: 'w1',
      maxNodes: 10,
      interactiveOnly: true,
      policy: allowAll,
    },
    registry,
    ownerA,
  )) as any;

  assert.deepEqual(
    await dispatchDesktopOperation({ kind: 'desktop.invalidateOwner' }, registry, ownerA),
    { invalidated: 1 },
  );
  await assert.rejects(
    () =>
      dispatchDesktopOperation(
        {
          kind: 'desktop.backgroundAct',
          action: {
            windowId: 'w1',
            windowLeaseId: desc.windowLeaseId,
            snapshotId: desc.snapshotId,
            ref: 'ref_1_1',
            op: 'invoke',
          },
          policy: allowAll,
        },
        registry,
        ownerA,
      ),
    /DESKTOP_LEASE_EXPIRED/,
  );
});

test('backgroundAct succeeds and performs semantic action', async () => {
  const { registry } = await connected();
  const desc = (await dispatchDesktopOperation(
    {
      kind: 'desktop.describe',
      mode: 'background',
      windowId: 'w1',
      maxNodes: 10,
      interactiveOnly: true,
      policy: allowAll,
    },
    registry,
    ownerA,
  )) as any;

  const result = (await dispatchDesktopOperation(
    {
      kind: 'desktop.backgroundAct',
      action: {
        windowId: 'w1',
        windowLeaseId: desc.windowLeaseId,
        snapshotId: desc.snapshotId,
        ref: 'ref_1_1',
        op: 'invoke',
      },
      policy: allowAll,
    },
    registry,
    ownerA,
  )) as any;

  assert.equal(result.ok, true);
  assert.equal(result.outcome, 'completed');
  assert.equal(result.snapshotInvalidated, true);
  assert.equal(result.requiresDescribe, true);
});

test('target denied while foreground allowed refuses backgroundAct with zero dispatch', async () => {
  const { registry, driver } = await connected();
  let actDispatched = false;
  driver.backgroundAct = async () => {
    actDispatched = true;
    return { ok: true, outcome: 'completed', focusChanged: false };
  };

  const desc = (await dispatchDesktopOperation(
    {
      kind: 'desktop.describe',
      mode: 'background',
      windowId: 'w1',
      maxNodes: 10,
      interactiveOnly: true,
      policy: allowAll,
    },
    registry,
    ownerA,
  )) as any;

  // Foreground is allowed (allowAll), but target policy denies notepad.exe
  const targetDenyingPolicy = {
    mode: 'denylist' as const,
    applications: ['notepad.exe'],
    unattributedInput: 'deny' as const,
  };

  await assert.rejects(
    () =>
      dispatchDesktopOperation(
        {
          kind: 'desktop.backgroundAct',
          action: {
            windowId: 'w1',
            windowLeaseId: desc.windowLeaseId,
            snapshotId: desc.snapshotId,
            ref: 'ref_1_1',
            op: 'invoke',
          },
          policy: targetDenyingPolicy,
        },
        registry,
        ownerA,
      ),
    (err: any) => err.code === 'DESKTOP_INPUT_REFUSED',
  );

  assert.equal(actDispatched, false);
});
