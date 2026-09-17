import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { DesktopSessionRegistry } from '../../../packages/desktop/src/registry.js';
import { FakeDesktopDriver } from '../../../packages/desktop/test/fake-driver.js';
import { dispatchDesktopOperation } from '../src/desktop-dispatch.js';
import { desktopRuntime } from '../src/desktop-runtime.js';

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
// forced to a path that cannot exist so this assertion is deterministic
// regardless of whatever a developer has actually built locally.
test('desktopRuntime.registry() connect() rejects with DESKTOP_HELPER_NOT_INSTALLED when the binary cannot be found', async () => {
  const original = process.env.AEVRA_DESKTOP_HELPER_PATH;
  process.env.AEVRA_DESKTOP_HELPER_PATH = fileURLToPath(
    new URL('./does-not-exist.exe', import.meta.url),
  );
  try {
    await assert.rejects(() => desktopRuntime.registry().connect(), /DESKTOP_HELPER_NOT_INSTALLED/);
  } finally {
    if (original === undefined) delete process.env.AEVRA_DESKTOP_HELPER_PATH;
    else process.env.AEVRA_DESKTOP_HELPER_PATH = original;
  }
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
