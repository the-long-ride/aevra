import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { HelperProcess } from '../src/helper-process.js';
import { WindowsDesktopDriver } from '../src/windows-driver.js';

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
const RELEASE_BINARY = fileURLToPath(
  new URL('../../../../helper/target/release/aevra-desktop-helper.exe', import.meta.url),
);
const DEBUG_BINARY = fileURLToPath(
  new URL('../../../../helper/target/debug/aevra-desktop-helper.exe', import.meta.url),
);
const BINARY = existsSync(RELEASE_BINARY)
  ? RELEASE_BINARY
  : existsSync(DEBUG_BINARY)
    ? DEBUG_BINARY
    : undefined;

const SKIP =
  BINARY === undefined
    ? 'The compiled desktop helper binary was not found. Build it with `cargo build` ' +
      '(or `cargo build --release`) inside helper/, then re-run this test.'
    : false;

function makeDriver(): { driver: WindowsDesktopDriver; teardown: () => Promise<void> } {
  const helper = new HelperProcess({ command: BINARY as string, args: [], deadlineMs: 5000 });
  const driver = new WindowsDesktopDriver(helper);
  return { driver, teardown: () => driver.disconnect() };
}

test('real helper: connect reports every capability true', { skip: SKIP }, async () => {
  const { driver, teardown } = makeDriver();
  try {
    const capabilities = await driver.connect();
    assert.equal(capabilities.attribution, true);
    assert.equal(capabilities.capture, true);
    assert.equal(capabilities.tree, true);
    assert.equal(capabilities.input, true);
  } finally {
    await teardown();
  }
});

test('real helper: focusedWindow returns an object with a windowId', { skip: SKIP }, async () => {
  const { driver, teardown } = makeDriver();
  try {
    await driver.connect();
    const window = await driver.focusedWindow();
    assert.equal(typeof window.windowId, 'string');
    assert.ok(window.windowId.length > 0);
  } finally {
    await teardown();
  }
});

test('real helper: windows returns a non-empty array', { skip: SKIP }, async () => {
  const { driver, teardown } = makeDriver();
  try {
    await driver.connect();
    const windows = await driver.windows();
    assert.ok(Array.isArray(windows));
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
test('real helper: describe returns a real, shape-correct tree', { skip: SKIP }, async () => {
  const { driver, teardown } = makeDriver();
  try {
    await driver.connect();
    const described = await driver.describe({ maxNodes: 200, interactiveOnly: false });
    assert.equal(typeof described.truncated, 'boolean');
    assert.ok(Array.isArray(described.nodes));
    assert.ok(described.nodes.length > 0, 'expected at least one node from the real desktop');
    assert.equal(typeof described.window.windowId, 'string');
    assert.ok(described.window.windowId.length > 0);
    for (const node of described.nodes) {
      assert.match(node.ref, /^ref_\d+_\d+$/);
      assert.equal(typeof node.role, 'string');
      assert.ok(node.role.length > 0);
      assert.equal(typeof node.name, 'string');
      assert.equal(typeof node.enabled, 'boolean');
      assert.equal(typeof node.focused, 'boolean');
      if (node.value !== undefined) {
        assert.equal(typeof node.value, 'string');
      }
    }
  } finally {
    await teardown();
  }
});

test(
  'real helper: describe with interactiveOnly still returns shape-correct nodes',
  { skip: SKIP },
  async () => {
    const { driver, teardown } = makeDriver();
    try {
      await driver.connect();
      const described = await driver.describe({ maxNodes: 200, interactiveOnly: true });
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
  async () => {
    const { driver, teardown } = makeDriver();
    try {
      await driver.connect();
      // This runs against whatever windows happen to be open, so it cannot
      // assume the focused window has more than one node. Asserting
      // `truncated === true` unconditionally is what the first version of
      // this test did, and it failed the moment a window with a single
      // describable node held focus.
      const full = await driver.describe({ maxNodes: 200, interactiveOnly: false });
      const capped = await driver.describe({ maxNodes: 1, interactiveOnly: false });
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
      // Rejected by the chord parser before a single key event is sent, so
      // this cannot leak keystrokes into the focused window.
      await assert.rejects(() => driver.act({ op: 'key', keys: 'hyper+q' }));
    } finally {
      await teardown();
    }
  },
);

// WHY THESE CAPTURE TESTS CAN SKIP THEMSELVES MID-RUN.
//
// `capture` refuses a uniform image rather than returning it, because a
// black rectangle presented as a successful screenshot is the worst outcome
// this subsystem has (see helper/src/capture.rs). A locked, asleep, or
// blank display legitimately produces exactly that refusal, and a test
// cannot tell that apart from a real defect by looking at the error. So it
// skips, and says why. The refusal itself is covered by a Rust unit test
// that constructs a blank frame directly, so nothing goes unverified here.
const UNIFORM = /uniform \d+x\d+ image/;

test(
  'real helper: capture returns a real JPEG data URI and a usable devicePixelRatio',
  { skip: SKIP },
  async (t) => {
    const { driver, teardown } = makeDriver();
    try {
      await driver.connect();
      let shot;
      try {
        shot = await driver.capture();
      } catch (error) {
        if (UNIFORM.test(String(error))) {
          t.skip('the display is blank (locked or asleep), so there is nothing to capture');
          return;
        }
        throw error;
      }
      // Anchored, and requires a non-trivial payload: an empty-payload data
      // URI must fail this.
      assert.match(shot.imageDataUri, /^data:image\/jpeg;base64,[A-Za-z0-9+/]{32,}={0,2}$/);
      // Image pixels per screen coordinate. A caller divides an image
      // coordinate by this to get something clickable, so a zero or negative
      // value would be unusable.
      assert.ok(shot.devicePixelRatio > 0, `devicePixelRatio was ${shot.devicePixelRatio}`);
      assert.ok(shot.devicePixelRatio <= 1, 'capture never upscales, so the ratio cannot exceed 1');
      // A primary-monitor capture is not one window's pixels, so it must not
      // be labelled with one window's identity - the tool layer audits this
      // field as the capture's target.
      assert.equal(shot.window, null);
    } finally {
      await teardown();
    }
  },
);

test(
  'real helper: capturing one window reports that window identity',
  { skip: SKIP },
  async (t) => {
    const { driver, teardown } = makeDriver();
    try {
      await driver.connect();
      const focused = await driver.focusedWindow();
      let shot;
      try {
        shot = await driver.capture(focused.windowId);
      } catch (error) {
        if (UNIFORM.test(String(error))) {
          t.skip('the focused window captured blank, which capture refuses by design');
          return;
        }
        throw error;
      }
      assert.match(shot.imageDataUri, /^data:image\/jpeg;base64,[A-Za-z0-9+/]{32,}={0,2}$/);
      assert.ok(shot.devicePixelRatio > 0);
      assert.equal(shot.window?.windowId, focused.windowId);
    } finally {
      await teardown();
    }
  },
);

test(
  'real helper: capturing a windowId that does not exist is an error',
  { skip: SKIP },
  async () => {
    const { driver, teardown } = makeDriver();
    try {
      await driver.connect();
      await assert.rejects(() => driver.capture('999999999'));
    } finally {
      await teardown();
    }
  },
);
