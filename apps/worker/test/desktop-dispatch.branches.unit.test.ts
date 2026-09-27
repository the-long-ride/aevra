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
const owner = {
  identity: { kind: 'oauth' as const, key: 'connection-A' },
  surface: 'desktop.control' as const,
};
const HOST = {
  executablePath: 'C:\\Apps\\Host.exe',
  instance: { windowId: 'h1', processId: 77, processStartedAt: '2026-09-18T00:00:00Z' },
};
const INSTANCE = { windowId: 'w1', processId: 1234, processStartedAt: '2026-09-18T00:00:00Z' };

async function connected() {
  const driver: any = new FakeDesktopDriver({
    capture: true,
    tree: true,
    attribution: true,
    input: true,
  });
  const registry = new DesktopSessionRegistry({ createDriver: async () => driver });
  await registry.connect();
  return { registry, driver };
}

const dispatch = (op: unknown, registry: DesktopSessionRegistry, who: unknown = owner) =>
  dispatchDesktopOperation(op as any, registry, who as any);

/** No verified session owner at all - not the default owner. */
const anonymous = (op: unknown, registry: DesktopSessionRegistry) =>
  dispatchDesktopOperation(op as any, registry, undefined);

const background = (policy: unknown = allowAll) => ({
  kind: 'desktop.describe',
  mode: 'background',
  windowId: 'w1',
  maxNodes: 10,
  interactiveOnly: true,
  ...(policy ? { policy } : {}),
});

const code = (expected: string) => (error: any) => error.code === expected;

test('connect, status and disconnect are served by the registry directly', async () => {
  const { registry } = await connected();
  assert.equal(((await dispatch({ kind: 'desktop.status' }, registry)) as any).connected, true);
  await dispatch({ kind: 'desktop.disconnect' }, registry);
  assert.equal(((await dispatch({ kind: 'desktop.status' }, registry)) as any).connected, false);
  const caps: any = await dispatch({ kind: 'desktop.connect' }, registry);
  assert.equal(caps.input, true);
});

test('owner invalidation without an owner is refused', async () => {
  const { registry } = await connected();
  await assert.rejects(
    anonymous({ kind: 'desktop.invalidateOwner' }, registry),
    code('DESKTOP_OWNER_REQUIRED'),
  );
});

test('windows and target identity route to the driver; identity needs driver support', async () => {
  const { registry, driver } = await connected();
  const windows: any = await dispatch({ kind: 'desktop.windows' }, registry);
  assert.equal(windows[0].windowId, 'w1');
  const identity: any = await dispatch(
    { kind: 'desktop.targetIdentity', windowId: 'w7' },
    registry,
  );
  assert.deepEqual(identity.windowInstance.windowId, 'w7');
  driver.targetIdentity = undefined;
  await assert.rejects(
    dispatch({ kind: 'desktop.targetIdentity', windowId: 'w7' }, registry),
    code('DESKTOP_BACKGROUND_UNSUPPORTED'),
  );
});

test('background describe requires an owner, a window id and driver support', async () => {
  const { registry, driver } = await connected();
  await assert.rejects(anonymous(background(), registry), code('DESKTOP_LEASE_EXPIRED'));
  await assert.rejects(
    dispatch({ ...background(), windowId: undefined }, registry),
    code('DESKTOP_TARGET_CHANGED'),
  );
  driver.describeBackground = undefined;
  await assert.rejects(dispatch(background(), registry), code('DESKTOP_BACKGROUND_UNSUPPORTED'));
});

test('background describe without a policy skips the gate and strips node handles', async () => {
  const { registry, driver } = await connected();
  const original = driver.describeBackground.bind(driver);
  driver.describeBackground = async (request: any) => {
    const result = await original(request);
    return { ...result, nodes: [{ ...result.nodes[0], handle: 'native-handle' }] };
  };
  const described: any = await dispatch(background(null), registry);
  assert.equal(described.nodes.length, 1);
  assert.equal('handle' in described.nodes[0], false);
  assert.ok(described.windowLeaseId);
});

test('an unattributable background target is refused naming the missing identity', async () => {
  const { registry, driver } = await connected();
  driver.targetIdentity = async (windowId: string) => ({
    window: { windowId, title: 'Nameless' },
    windowInstance: { ...INSTANCE, windowId },
  });
  await assert.rejects(dispatch(background(), registry), (error: any) => {
    assert.equal(error.code, 'DESKTOP_INPUT_REFUSED');
    assert.match(error.message, /\(unattributable window\)/);
    assert.equal(error.details.gateVerdict, 'deny');
    return true;
  });
});

function withHosts(driver: any, targetHost: unknown, describedHost: unknown) {
  driver.targetIdentity = async (windowId: string) => ({
    window: { windowId, processName: 'notepad.exe' },
    windowInstance: INSTANCE,
    ...(targetHost ? { hostApplication: targetHost } : {}),
  });
  const original = FakeDesktopDriver.prototype.describeBackground.bind(driver);
  driver.describeBackground = async (request: any) => ({
    ...(await original(request)),
    ...(describedHost ? { hostApplication: describedHost } : {}),
  });
}

test('a background describe whose verified host matches keeps its lease', async () => {
  const { registry, driver } = await connected();
  withHosts(driver, HOST, { ...HOST, executablePath: 'c:/apps/host.exe' });
  const described: any = await dispatch(background(), registry);
  assert.ok(described.snapshotId);
  assert.equal(registry.backgroundState.isWindowLeased('w1'), true);
});

for (const [label, describedHost] of [
  ['a missing host', undefined],
  ['another window', { ...HOST, instance: { ...HOST.instance, windowId: 'h2' } }],
  ['another process', { ...HOST, instance: { ...HOST.instance, processId: 78 } }],
  ['a restarted process', { ...HOST, instance: { ...HOST.instance, processStartedAt: 'later' } }],
  ['another executable', { ...HOST, executablePath: 'C:\\Apps\\Other.exe' }],
] as const) {
  test(`a background describe that reports ${label} is refused and its lease released`, async () => {
    const { registry, driver } = await connected();
    withHosts(driver, HOST, describedHost);
    const released: string[] = [];
    driver.releaseBackgroundSnapshot = async (id: string) => {
      released.push(id);
      throw new Error('release failure is ignored');
    };
    await assert.rejects(dispatch(background(), registry), code('DESKTOP_TARGET_CHANGED'));
    assert.equal(released.length, 1);
    assert.equal(registry.backgroundState.isWindowLeased('w1'), false);
  });
}

test('a changed window instance without snapshot release support still frees the lease', async () => {
  const { registry, driver } = await connected();
  driver.releaseBackgroundSnapshot = undefined;
  const original = FakeDesktopDriver.prototype.describeBackground.bind(driver);
  driver.describeBackground = async (request: any) => ({
    ...(await original(request)),
    windowInstance: { ...INSTANCE, processId: 999 },
  });
  await assert.rejects(dispatch(background(), registry), code('DESKTOP_TARGET_CHANGED'));
  assert.equal(registry.backgroundState.isWindowLeased('w1'), false);
});

test('releaseWindow needs an owner and works without driver snapshot release', async () => {
  const { registry, driver } = await connected();
  const described: any = await dispatch(background(), registry);
  const release = {
    kind: 'desktop.releaseWindow',
    windowId: 'w1',
    windowLeaseId: described.windowLeaseId,
  };
  await assert.rejects(anonymous(release, registry), code('DESKTOP_LEASE_EXPIRED'));
  driver.releaseBackgroundSnapshot = undefined;
  assert.deepEqual(await dispatch(release, registry), { ok: true, released: true });
});

async function leased() {
  const context = await connected();
  const described: any = await dispatch(background(), context.registry);
  const act = {
    kind: 'desktop.backgroundAct',
    action: {
      windowId: 'w1',
      windowLeaseId: described.windowLeaseId,
      snapshotId: described.snapshotId,
      ref: 'ref_1_1',
      op: 'invoke',
    },
    policy: allowAll,
  };
  return { ...context, act };
}

test('backgroundAct needs an owner and driver target identity', async () => {
  const { registry, driver, act } = await leased();
  await assert.rejects(anonymous(act, registry), code('DESKTOP_LEASE_EXPIRED'));
  driver.targetIdentity = undefined;
  await assert.rejects(dispatch(act, registry), code('DESKTOP_BACKGROUND_UNSUPPORTED'));
});

test('backgroundAct refuses a target whose live instance changed', async () => {
  const { registry, driver, act } = await leased();
  driver.targetIdentity = async (windowId: string) => ({
    window: { windowId, processName: 'notepad.exe' },
    windowInstance: { ...INSTANCE, processStartedAt: 'restarted' },
  });
  await assert.rejects(dispatch(act, registry), code('DESKTOP_TARGET_CHANGED'));
});

test('backgroundAct refuses a live target that lost its attribution', async () => {
  const { registry, driver, act } = await leased();
  driver.targetIdentity = async (windowId: string) => ({
    window: { windowId },
    windowInstance: INSTANCE,
  });
  await assert.rejects(dispatch(act, registry), (error: any) => {
    assert.equal(error.code, 'DESKTOP_INPUT_REFUSED');
    assert.match(error.message, /Background action refused: .*\(unattributable window\)/);
    return true;
  });
});

test('foreground input without target identity is gated on the focused window', async () => {
  const { registry, driver } = await connected();
  driver.targetIdentity = undefined;
  await dispatch({ kind: 'desktop.describe', maxNodes: 10, interactiveOnly: true }, registry);
  const result: any = await dispatch(
    { kind: 'desktop.act', op: 'click', ref: 'ref_1_1', policy: allowAll },
    registry,
  );
  assert.equal(result.gateVerdict, 'allow');
  assert.equal(result.window.processName, 'notepad.exe');

  driver.focusedWindow = async () => ({ windowId: 'w9', title: 'Secure desktop' });
  await assert.rejects(
    dispatch({ kind: 'desktop.act', op: 'key', keys: 'Enter', policy: allowAll }, registry),
    (error: any) => {
      assert.equal(error.code, 'DESKTOP_INPUT_REFUSED');
      assert.match(error.message, /\(unattributable window\)/);
      assert.equal('hostApplication' in error.details, false);
      return true;
    },
  );
});

test('a refused foreground input reports the verified host application', async () => {
  const { registry, driver } = await connected();
  driver.targetIdentity = async (windowId: string) => ({
    window: { windowId, processName: 'notepad.exe' },
    windowInstance: INSTANCE,
    hostApplication: HOST,
  });
  const policy = { mode: 'denylist', applications: ['notepad.exe'], unattributedInput: 'deny' };
  await assert.rejects(
    dispatch({ kind: 'desktop.act', op: 'key', keys: 'Enter', policy }, registry),
    (error: any) => {
      assert.equal(error.code, 'DESKTOP_INPUT_REFUSED');
      assert.deepEqual(error.details.hostApplication, HOST);
      return true;
    },
  );
});
