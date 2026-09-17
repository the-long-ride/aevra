import assert from 'node:assert/strict';
import test from 'node:test';
import type { DesktopDriver } from '../src/driver.js';

export interface DesktopConformanceHarness {
  driver: DesktopDriver;
  /** Accessible name of a control the harness guarantees exists. */
  buttonName: string;
  teardown: () => Promise<void>;
}

export function runDesktopConformance(
  label: string,
  createHarness: () => Promise<DesktopConformanceHarness>,
): void {
  test(`${label}: connect reports four independent capability flags`, async () => {
    const harness = await createHarness();
    try {
      const capabilities = await harness.driver.connect();
      for (const key of ['capture', 'tree', 'attribution', 'input'] as const) {
        assert.equal(typeof capabilities[key], 'boolean');
      }
    } finally {
      await harness.teardown();
    }
  });

  test(`${label}: describe yields addressable refs`, async () => {
    const harness = await createHarness();
    try {
      await harness.driver.connect();
      const described = await harness.driver.describe({ maxNodes: 100, interactiveOnly: true });
      const button = described.nodes.find((node) => node.name === harness.buttonName);
      assert.ok(button, 'expected the button to appear in the tree');
      assert.match(button.ref, /^ref_\d+_\d+$/);
    } finally {
      await harness.teardown();
    }
  });

  test(`${label}: every action returns a delta`, async () => {
    const harness = await createHarness();
    try {
      await harness.driver.connect();
      const described = await harness.driver.describe({ maxNodes: 100, interactiveOnly: true });
      const button = described.nodes.find((node) => node.name === harness.buttonName)!;
      const result = await harness.driver.act({ op: 'click', ref: button.ref });
      assert.equal(result.ok, true);
      // The delta is what removes the click-then-re-describe loop. A driver that
      // omits it silently doubles the token cost of every step.
      assert.equal(typeof result.delta.focusChanged, 'boolean');
      assert.equal(typeof result.delta.newWindow, 'boolean');
      assert.equal(typeof result.delta.subtreeChanged, 'boolean');
    } finally {
      await harness.teardown();
    }
  });

  test(`${label}: a stale ref fails with DESKTOP_REF_STALE rather than acting`, async () => {
    const harness = await createHarness();
    try {
      await harness.driver.connect();
      await harness.driver.describe({ maxNodes: 100, interactiveOnly: true });
      await assert.rejects(
        () => harness.driver.act({ op: 'click', ref: 'ref_99_99' }),
        /DESKTOP_REF_STALE/,
      );
    } finally {
      await harness.teardown();
    }
  });

  test(`${label}: capture reports a usable devicePixelRatio`, async () => {
    const harness = await createHarness();
    try {
      await harness.driver.connect();
      const shot = await harness.driver.capture();
      // Anchored at the end and requires a real (non-trivial) base64 payload,
      // not just the prefix — an empty-payload data URI must fail this.
      assert.match(shot.imageDataUri, /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]{32,}={0,2}$/);
      // Screenshot pixels and click coordinates must share one space.
      assert.ok(shot.devicePixelRatio > 0);
    } finally {
      await harness.teardown();
    }
  });
}
