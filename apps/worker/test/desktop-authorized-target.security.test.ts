import assert from 'node:assert/strict';
import test from 'node:test';
import { DesktopSessionRegistry } from '../../../packages/desktop/src/registry.js';
import { FakeDesktopDriver } from '../../../packages/desktop/test/fake-driver.js';
import { DesktopDriverError } from '../../../packages/desktop/src/driver.js';
import { dispatchDesktopOperation } from '../src/desktop-dispatch.js';

for (const action of [
  { op: 'click' as const, x: 30, y: 40 },
  { op: 'type' as const, text: 'notes' },
  { op: 'key' as const, keys: 'ctrl+a' },
  { op: 'scroll' as const, deltaY: 120 },
]) {
  test(`${action.op} carries the authorized identity across an intervening focus change`, async () => {
    const driver = new FakeDesktopDriver({
      capture: true,
      tree: true,
      attribution: true,
      input: true,
    });
    const authorized = await driver.targetIdentity('w1');
    let effects = 0;
    driver.act = async (request) => {
      // Represents a native boundary reached after focus changed to blocked B.
      const expected = request.expectedTarget;
      assert.deepEqual(expected, authorized, 'must bind the identity that passed the policy gate');
      if (expected)
        throw new DesktopDriverError('DESKTOP_TARGET_CHANGED', 'authorized target changed');
      effects++;
      return { ok: true, delta: { focusChanged: false, newWindow: false, subtreeChanged: false } };
    };
    const registry = new DesktopSessionRegistry({ createDriver: async () => driver });
    await registry.connect();
    await assert.rejects(
      dispatchDesktopOperation(
        {
          kind: 'desktop.act',
          ...action,
          policy: { mode: 'allowlist', applications: ['notepad.exe'], unattributedInput: 'deny' },
        },
        registry,
      ),
      (error: unknown) => {
        assert.ok(error instanceof DesktopDriverError);
        assert.equal(error.code, 'DESKTOP_TARGET_CHANGED');
        assert.deepEqual(error.details?.window, authorized.window);
        return true;
      },
    );
    assert.equal(effects, 0);
  });
}

for (const kind of ['desktop.capture', 'desktop.describe'] as const) {
  test(`${kind} binds reads to the identity authorized before native dispatch`, async () => {
    const driver = new FakeDesktopDriver({
      capture: true,
      tree: true,
      attribution: true,
      input: true,
    });
    const expected = await driver.targetIdentity('w1');
    const capture = driver.capture.bind(driver),
      describe = driver.describe.bind(driver);
    driver.capture = async (id, target) => {
      assert.deepEqual(target, expected);
      return capture(id, target);
    };
    driver.describe = async (request) => {
      assert.deepEqual(request.expectedTarget, expected);
      return describe(request);
    };
    const registry = new DesktopSessionRegistry({ createDriver: async () => driver });
    await registry.connect();
    try {
      await dispatchDesktopOperation(
        {
          kind,
          windowId: 'w1',
          maxNodes: 50,
          interactiveOnly: false,
          policy: { mode: 'allowlist', applications: ['notepad.exe'], unattributedInput: 'deny' },
        },
        registry,
      );
    } finally {
      await registry.disconnect();
    }
  });
}
