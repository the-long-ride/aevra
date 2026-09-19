import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { HelperProcess } from '../src/helper-process.js';
import { WindowsDesktopDriver } from '../src/windows-driver.js';
import { runDesktopConformance } from './conformance.js';

const SCRIPT = fileURLToPath(new URL('./fake-helper.js', import.meta.url));

function makeHelper(mode = 'driver', deadlineMs = 2000): HelperProcess {
  return new HelperProcess({ command: process.execPath, args: [SCRIPT, mode], deadlineMs });
}

runDesktopConformance('WindowsDesktopDriver', async () => {
  const helper = makeHelper();
  const driver = new WindowsDesktopDriver(helper);
  return { driver, buttonName: 'Save', teardown: () => driver.disconnect() };
});

// The conformance suite's own delta assertion only checks `typeof === 'boolean'`,
// so a driver returning an all-false delta would still pass it. This fake
// helper's `screenState` bumps its signature on every `act`, so this test
// proves the delta is computed from real before/after state.
test('WindowsDesktopDriver: an act that changes screen state reports subtreeChanged', async () => {
  const helper = makeHelper();
  const driver = new WindowsDesktopDriver(helper);
  try {
    await driver.connect();
    const described = await driver.describe({ maxNodes: 100, interactiveOnly: true });
    const button = described.nodes.find((node) => node.name === 'Save')!;
    const result = await driver.act({ op: 'click', ref: button.ref });
    assert.equal(result.delta.subtreeChanged, true);
    // Happy path: the marker must NOT be set, or a caller could never trust
    // any delta -- the conservative-delta fallback would be permanent and the
    // whole point of returning a delta (skipping a full re-describe) is lost.
    assert.equal(result.delta.postActionStateUnknown, undefined);
  } finally {
    await driver.disconnect();
  }
});

// This is the payoff of Task 5's generation counter: a ref minted before the
// helper died must not silently resolve against whatever now occupies those
// pixels. The helper is killed directly (deterministic, no dependence on a
// fake-helper mode's own timing). A subsequent describe() respawns the helper
// at the new generation and repopulates the ref map from scratch, so the OLD
// ref -- never re-added -- is simply absent, which is exactly what act() checks.
test('WindowsDesktopDriver: a ref minted before the helper dies is refused afterwards', async () => {
  const helper = makeHelper();
  const driver = new WindowsDesktopDriver(helper);
  try {
    await driver.connect();
    const described = await driver.describe({ maxNodes: 100, interactiveOnly: true });
    const staleRef = described.nodes.find((node) => node.name === 'Save')!.ref;

    helper.kill();

    await driver.describe({ maxNodes: 100, interactiveOnly: true });

    await assert.rejects(() => driver.act({ op: 'click', ref: staleRef }), /DESKTOP_REF_STALE/);
  } finally {
    await driver.disconnect();
  }
});

// REVIEW FIX: act() makes three helper calls (screenState, act, screenState).
// A failure of the TRAILING screenState must not discard an action that already
// happened -- the caller needs `ok` and a conservative delta, not an exception
// that makes a landed click indistinguishable from one that never fired.
test('WindowsDesktopDriver: a failed trailing screenState still returns the completed action, marked unreliable', async () => {
  // The failure is manufactured by the fake helper never answering the second
  // screenState call. Keep the deadline bounded, but leave enough room for a
  // fresh Node child to start on a busy CI worker.
  const helper = makeHelper('driver-fail-second-state', 1000);
  const driver = new WindowsDesktopDriver(helper);
  try {
    await driver.connect();
    const described = await driver.describe({ maxNodes: 100, interactiveOnly: true });
    const button = described.nodes.find((node) => node.name === 'Save')!;
    const result = await driver.act({ op: 'click', ref: button.ref });
    // The action itself (the middle call) succeeded, and act() must resolve,
    // not reject, even though the trailing screenState read failed.
    assert.equal(result.ok, true);
    assert.equal(result.delta.postActionStateUnknown, true);
    assert.equal(result.delta.focusChanged, true);
    assert.equal(result.delta.newWindow, true);
    assert.equal(result.delta.subtreeChanged, true);
  } finally {
    await driver.disconnect();
  }
});

// REVIEW FIX: a failure of the LEADING screenState must still reject --
// nothing has happened yet at that point, so there is no outcome to preserve.
test('WindowsDesktopDriver: a failed leading screenState still rejects act()', async () => {
  const helper = makeHelper('driver-fail-first-state', 1000);
  const driver = new WindowsDesktopDriver(helper);
  try {
    await driver.connect();
    const described = await driver.describe({ maxNodes: 100, interactiveOnly: true });
    const button = described.nodes.find((node) => node.name === 'Save')!;
    await assert.rejects(() => driver.act({ op: 'click', ref: button.ref }));
  } finally {
    await driver.disconnect();
  }
});

// ROUND 2 FIX: round 1's fallback delta was a single module-level constant
// returned by reference from every degraded act(). Nothing mutates it today,
// but a caller writing `result.delta.subtreeChanged = false` once would
// corrupt it for every later failure, process-wide. Two degraded act() calls
// must return distinct objects, and mutating the first must not leak into
// the second.
test('WindowsDesktopDriver: the unreliable delta is a fresh object each time, not a shared reference', async () => {
  const helper = makeHelper('driver-fail-second-state', 1000);
  const driver = new WindowsDesktopDriver(helper);
  try {
    await driver.connect();
    const described = await driver.describe({ maxNodes: 100, interactiveOnly: true });
    const button = described.nodes.find((node) => node.name === 'Save')!;

    const first = await driver.act({ op: 'click', ref: button.ref });
    const second = await driver.act({ op: 'click', ref: button.ref });

    assert.notEqual(first.delta, second.delta);

    first.delta.subtreeChanged = false;
    assert.equal(second.delta.subtreeChanged, true);
  } finally {
    await driver.disconnect();
  }
});

test('WindowsDesktopDriver: repeated descriptions never reuse public refs', async () => {
  const helper = makeHelper();
  const driver = new WindowsDesktopDriver(helper);
  try {
    await driver.connect();
    const first = await driver.describe({ maxNodes: 100, interactiveOnly: true });
    const second = await driver.describe({ maxNodes: 100, interactiveOnly: true });
    const firstRefs = new Set(first.nodes.map((n) => n.ref));
    for (const node of second.nodes) {
      assert.equal(firstRefs.has(node.ref), false);
    }
  } finally {
    await driver.disconnect();
  }
});
