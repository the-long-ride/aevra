import assert from 'node:assert/strict';
import test from 'node:test';
import { RefRegistry } from '../src/dom-snapshot.js';
import { handleExtensionCommand, type ExtensionBridge } from '../src/extension-bridge.js';
import { FIXTURE_PAGE } from './fixtures.js';

/**
 * The fixture button sits at (10, 10) and is 100x30 CSS pixels. Every case here
 * checks the same thing from a different ratio: what vision mode hands back has
 * to be in the screenshot's own pixel space, because that is the only space the
 * model can point at.
 */
function bridge(ratio: number): ExtensionBridge {
  return {
    async listTabs() {
      return [
        {
          tabId: '1',
          url: 'https://example.com/',
          title: 'Example',
          active: true,
          originClass: 'NORMAL',
        },
      ];
    },
    async serialize() {
      return FIXTURE_PAGE;
    },
    async devicePixelRatio() {
      return ratio;
    },
    async apply() {
      return { ok: true };
    },
    async captureVisible() {
      return 'data:image/png;base64,AAAA';
    },
    async navigate(url: string) {
      return { tabId: '1', url, status: 200, redirected: false };
    },
    async logs() {
      return [];
    },
  };
}

async function visionBoxes(ratio: number) {
  const result: any = await handleExtensionCommand(new RefRegistry(), bridge(ratio), {
    op: 'snapshot',
    params: { mode: 'vision', maxNodes: 100 },
  });
  return result;
}

test('a vision snapshot reports the ratio its screenshot was captured at', async () => {
  const result = await visionBoxes(2);
  assert.equal(result.devicePixelRatio, 2);
});

test('boxes are scaled into the screenshot pixel space on a HiDPI display', async () => {
  const result = await visionBoxes(2);
  const box = result.boxes.find((entry: any) => entry.label === 'New invoice')?.box;
  assert.ok(box, 'expected the fixture button to carry a box');
  assert.deepEqual(box, { x: 20, y: 20, width: 200, height: 60 });
});

test('boxes pass through unchanged when the display is not scaled', async () => {
  const result = await visionBoxes(1);
  const box = result.boxes.find((entry: any) => entry.label === 'New invoice')?.box;
  assert.deepEqual(box, { x: 10, y: 10, width: 100, height: 30 });
});

test('a fractional ratio scales boxes without rounding them to integers', async () => {
  const result = await visionBoxes(1.5);
  const box = result.boxes.find((entry: any) => entry.label === 'New invoice')?.box;
  assert.deepEqual(box, { x: 15, y: 15, width: 150, height: 45 });
});
