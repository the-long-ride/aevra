import assert from 'node:assert/strict';
import test from 'node:test';
import { DesktopSessionRegistry } from '../../../packages/desktop/src/registry.js';
import { FakeDesktopDriver } from '../../../packages/desktop/test/fake-driver.js';
import { dispatchDesktopOperation } from '../src/desktop-dispatch.js';

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

const ownerA = { sessionId: 'session-A', workspaceId: 'ws-A' };
const ownerB = { sessionId: 'session-B', workspaceId: 'ws-B' };

test('target allowed while foreground unrelated succeeds without touching foreground', async () => {
  const { registry, driver } = await connected();
  driver.focusedWindow = async () => ({
    windowId: 'fg-forbidden',
    processName: 'forbidden.exe',
    title: 'Forbidden Foreground',
  });

  const desc = (await dispatchDesktopOperation(
    {
      kind: 'desktop.describe',
      mode: 'background',
      windowId: 'w1',
      maxNodes: 10,
      interactiveOnly: true,
      policy: { mode: 'allowlist', applications: ['notepad.exe'], unattributedInput: 'deny' },
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
      policy: { mode: 'allowlist', applications: ['notepad.exe'], unattributedInput: 'deny' },
    },
    registry,
    ownerA,
  )) as any;

  assert.equal(result.ok, true);
  assert.equal(result.window.processName, 'notepad.exe');
});

test('legacy foreground mutation against a background-leased window is rejected with DESKTOP_WINDOW_BUSY', async () => {
  const { registry, driver } = await connected();
  let legacyActDispatched = false;
  driver.act = async () => {
    legacyActDispatched = true;
    return { ok: true, delta: { focusChanged: false, newWindow: false, subtreeChanged: false } };
  };

  await dispatchDesktopOperation(
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
  );

  await assert.rejects(
    () =>
      dispatchDesktopOperation(
        {
          kind: 'desktop.act',
          op: 'click',
          ref: 'ref_1_1',
          policy: allowAll,
        },
        registry,
        ownerA,
      ),
    (err: any) => err.code === 'DESKTOP_WINDOW_BUSY',
  );

  assert.equal(legacyActDispatched, false);
});

test('releaseWindow frees lease and rejects foreign or repeated release', async () => {
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

  await assert.rejects(
    () =>
      dispatchDesktopOperation(
        {
          kind: 'desktop.releaseWindow',
          windowId: 'w1',
          windowLeaseId: desc.windowLeaseId,
        },
        registry,
        ownerB,
      ),
    (err: any) => err.code === 'DESKTOP_LEASE_EXPIRED',
  );

  const releaseResult = (await dispatchDesktopOperation(
    {
      kind: 'desktop.releaseWindow',
      windowId: 'w1',
      windowLeaseId: desc.windowLeaseId,
    },
    registry,
    ownerA,
  )) as any;
  assert.equal(releaseResult.ok, true);

  await assert.rejects(
    () =>
      dispatchDesktopOperation(
        {
          kind: 'desktop.releaseWindow',
          windowId: 'w1',
          windowLeaseId: desc.windowLeaseId,
        },
        registry,
        ownerA,
      ),
    (err: any) => err.code === 'DESKTOP_LEASE_EXPIRED',
  );
});

test('stolen refs across sessions or workspaces fail with DESKTOP_LEASE_EXPIRED', async () => {
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
        ownerB,
      ),
    (err: any) => err.code === 'DESKTOP_LEASE_EXPIRED',
  );
});
