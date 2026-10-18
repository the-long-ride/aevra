import assert from 'node:assert/strict';
import test from 'node:test';
import { BINARY, SKIP, makeDriver, NO_FOCUSED_WINDOW } from './real-helper-fixture.js';

// This test spawns the ACTUAL COMPILED binary (not the TypeScript
// fake-helper fixture) and proves the TypeScript supervisor and the real
// Rust helper agree on the wire protocol. It must skip cleanly -- not fail --
// on a machine that has not run `cargo build`, so the suite still passes
// there.
//
// `helper/` sits outside the TypeScript project tree: `tsconfig.json` sets
// `rootDir: "."`, and the test runner compiles into `.test-dist/`, which
// wraps the WHOLE source tree one directory deeper than this file's own
// source location. So this climbs one level further than the source-tree
// distance to `packages/desktop/test/` would suggest, landing beside
// `.test-dist` at the true repo root.
test(
  'required native run has a compiled helper',
  { skip: process.env.AEVRA_REQUIRE_NATIVE_DESKTOP !== '1' },
  () => {
    assert.ok(BINARY, 'required native helper missing; build helper/ first');
  },
);

test('real helper: connect reports runtime capability readiness', { skip: SKIP }, async () => {
  const { driver, teardown } = makeDriver();
  try {
    const cap = await driver.connect();
    assert.ok(cap.attribution && cap.tree);
    assert.equal(typeof cap.capture, 'boolean');
    assert.equal(typeof cap.input, 'boolean');
    if (process.platform === 'win32' || process.env.AEVRA_REQUIRE_NATIVE_DESKTOP === '1') {
      assert.ok(
        cap.capture && cap.input,
        'required capture/input permissions or native session unavailable',
      );
    }
  } finally {
    await teardown();
  }
});

test('real helper: focusedWindow returns an object with a windowId', { skip: SKIP }, async (t) => {
  const { driver, teardown } = makeDriver();
  try {
    await driver.connect();
    let window;
    try {
      window = await driver.focusedWindow();
    } catch (error) {
      if (NO_FOCUSED_WINDOW.test(String(error))) {
        t.skip('no focused window in current desktop session');
        return;
      }
      throw error;
    }
    assert.equal(typeof window.windowId, 'string');
    assert.ok(window.windowId.length > 0);
  } finally {
    await teardown();
  }
});

test('real helper: windows returns a non-empty array', { skip: SKIP }, async (t) => {
  const { driver, teardown } = makeDriver();
  try {
    await driver.connect();
    const windows = await driver.windows();
    assert.ok(Array.isArray(windows));
    if (windows.length === 0) {
      t.skip('no interactive desktop windows found in current session');
      return;
    }
    assert.ok(windows.length > 0);
  } finally {
    await teardown();
  }
});

// This machine's real desktop is whatever happens to be open on it (here,
// and on CI's windows-latest runner). We assert shape and invariants -- node
// shape, non-empty handles, a boolean `truncated` -- never that a specific
// application is running. A test that needs Notepad open is a test that
// fails on CI.
test('real helper: describe returns a real, shape-correct tree', { skip: SKIP }, async (t) => {
  const { driver, teardown } = makeDriver();
  try {
    await driver.connect();
    let described;
    try {
      described = await driver.describe({ maxNodes: 200, interactiveOnly: false });
    } catch (error) {
      if (NO_FOCUSED_WINDOW.test(String(error))) {
        t.skip('no focused window in current desktop session');
        return;
      }
      throw error;
    }
    assert.equal(typeof described.truncated, 'boolean');
    assert.ok(Array.isArray(described.nodes));
    assert.ok(described.nodes.length > 0, 'expected at least one node from the real desktop');
    assert.equal(typeof described.window.windowId, 'string');
    assert.ok(described.window.windowId.length > 0);
    for (const node of described.nodes) {
      assert.match(node.ref, /^ref_\d+_\d+$/);
      assert.equal(typeof node.role, 'string');
      assert.ok(node.role.length > 0 && typeof node.name === 'string');
      assert.equal(typeof node.enabled, 'boolean');
      assert.equal(typeof node.focused, 'boolean');
      if (node.value !== undefined) assert.equal(typeof node.value, 'string');
    }
  } finally {
    await teardown();
  }
});

test(
  'real helper: describe with interactiveOnly still returns shape-correct nodes',
  { skip: SKIP },
  async (t) => {
    const { driver, teardown } = makeDriver();
    try {
      await driver.connect();
      let described;
      try {
        described = await driver.describe({ maxNodes: 200, interactiveOnly: true });
      } catch (error) {
        if (NO_FOCUSED_WINDOW.test(String(error))) {
          t.skip('no focused window in current desktop session');
          return;
        }
        throw error;
      }
      assert.ok(Array.isArray(described.nodes));
      for (const node of described.nodes) {
        assert.match(node.ref, /^ref_\d+_\d+$/);
        assert.ok(node.role.length > 0);
      }
    } finally {
      await teardown();
    }
  },
);

test(
  'real helper: a tiny maxNodes caps the node count, and truncates when there is more to see',
  { skip: SKIP },
  async (t) => {
    const { driver, teardown } = makeDriver();
    try {
      await driver.connect();
      // This runs against whatever windows happen to be open, so it cannot
      // assume the focused window has more than one node. Asserting
      // `truncated === true` unconditionally is what the first version of
      // this test did, and it failed the moment a window with a single
      // describable node held focus.
      let full;
      let capped;
      try {
        full = await driver.describe({ maxNodes: 200, interactiveOnly: false });
        capped = await driver.describe({ maxNodes: 1, interactiveOnly: false });
      } catch (error) {
        if (NO_FOCUSED_WINDOW.test(String(error))) {
          t.skip('no focused window in current desktop session');
          return;
        }
        throw error;
      }
      assert.ok(capped.nodes.length <= 1, `the cap must hold, got ${capped.nodes.length}`);
      assert.equal(typeof capped.truncated, 'boolean');
      if (full.nodes.length > 1) {
        assert.equal(
          capped.truncated,
          true,
          'a tree with more nodes than the cap must report truncated',
        );
      }
    } finally {
      await teardown();
    }
  },
);

test(
  'real helper: a windowId that does not exist is an error, not an empty tree',
  { skip: SKIP },
  async () => {
    const { driver, teardown } = makeDriver();
    try {
      await driver.connect();
      await assert.rejects(() =>
        driver.describe({ windowId: '999999999', maxNodes: 10, interactiveOnly: false }),
      );
    } finally {
      await teardown();
    }
  },
);

// WHAT THESE ACT TESTS DELIBERATELY DO NOT DO.
//
// This suite runs on a machine someone is actually using, and `act` now
// synthesises real mouse and keyboard input into whatever window holds
// focus. A test that sent `ctrl+a` and then text would destroy that
// person's work in whatever happened to be focused. So nothing below ever
// reaches a successful injection: each case is refused by the helper
// BEFORE any input is sent, which is also where the security-relevant
// behaviour lives. The happy path -- input that actually lands -- is
// covered by the Rust unit tests for chord parsing and by manual
// verification, never by a test that types into someone's editor.

test(
  'real helper: a click with neither a handle nor coordinates is refused',
  { skip: SKIP },
  async () => {
    const { driver, teardown } = makeDriver();
    try {
      await driver.connect();
      // No ref, so the driver forwards no handle and the helper has nothing
      // to aim at. Refused before any synthesis.
      await assert.rejects(() => driver.act({ op: 'click' }));
    } finally {
      await teardown();
    }
  },
);

test(
  'real helper: a malformed key chord is refused and nothing is typed',
  { skip: SKIP },
  async () => {
    const { driver, teardown } = makeDriver();
    try {
      await driver.connect();
      // Missing authorization or the malformed chord is refused before effects.
      await assert.rejects(() => driver.act({ op: 'key', keys: 'hyper+q' }));
    } finally {
      await teardown();
    }
  },
);
