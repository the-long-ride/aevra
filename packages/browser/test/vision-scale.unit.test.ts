import assert from 'node:assert/strict';
import test from 'node:test';
import { RefRegistry } from '../src/dom-snapshot.js';
import { handleExtensionCommand, type ExtensionBridge } from '../src/extension-bridge.js';
import { FIXTURE_PAGE } from './fixtures.js';

/**
 * The fixture button sits at (10, 10) and is 100x30 CSS pixels. Every case here
 * checks the same thing from a different ratio: what vision mode hands back has
 * to be in the screenshot's own pixel space, because that is the only space the
 * model can point at - and coordinates the model sends back from that picture
 * have to be turned into CSS pixels by the same ratio.
 */
function bridge(ratio: number, applied: any[] = []): ExtensionBridge {
  return {
    async focus() {},
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
    async apply(action) {
      applied.push(action);
      return { ok: true };
    },
    async captureVisible() {
      return {
        imageDataUri: 'data:image/jpeg;base64,AAAA',
        devicePixelRatio: ratio,
        imageWidth: 1000 * ratio,
        imageHeight: 500 * ratio,
        viewport: { width: 1000, height: 500 },
      };
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

test('a vision snapshot carries the image size and the viewport it was taken of', async () => {
  const result = await visionBoxes(0.5);
  assert.equal(result.imageWidth, 500);
  assert.equal(result.imageHeight, 250);
  assert.deepEqual(result.viewport, { width: 1000, height: 500 });
});

test('a downscaled capture shrinks boxes by the same ratio as the image', async () => {
  const result = await visionBoxes(0.5);
  const box = result.boxes.find((entry: any) => entry.label === 'New invoice')?.box;
  assert.deepEqual(box, { x: 5, y: 5, width: 50, height: 15 });
});

test('a coordinate click is converted from image pixels by the last capture ratio', async () => {
  const applied: any[] = [];
  const registry = new RefRegistry();
  const driven = bridge(0.5, applied);
  await handleExtensionCommand(registry, driven, {
    op: 'snapshot',
    params: { mode: 'vision', maxNodes: 100 },
  });
  await handleExtensionCommand(registry, driven, {
    op: 'act',
    params: { actions: [{ op: 'click', x: 300, y: 120 }], stopOnError: true },
  });
  assert.deepEqual(applied, [{ op: 'click', x: 600, y: 240 }]);
});

test('both drag endpoints are converted from image pixels by the last capture ratio', async () => {
  const applied: any[] = [];
  const registry = new RefRegistry();
  const driven = bridge(0.5, applied);
  await handleExtensionCommand(registry, driven, {
    op: 'snapshot',
    params: { mode: 'vision', maxNodes: 100 },
  });
  await handleExtensionCommand(registry, driven, {
    op: 'act',
    params: { actions: [{ op: 'drag', x: 10, y: 20, toX: 100, toY: 150 }] },
  });
  assert.deepEqual(applied, [{ op: 'drag', x: 20, y: 40, toX: 200, toY: 300 }]);
});

test('the ratio is remembered per tab, so a named tab and the active one agree', async () => {
  const applied: any[] = [];
  const registry = new RefRegistry();
  const driven = bridge(2, applied);
  await handleExtensionCommand(registry, driven, {
    op: 'snapshot',
    params: { mode: 'vision', maxNodes: 100 },
  });
  await handleExtensionCommand(registry, driven, {
    op: 'act',
    params: { actions: [{ op: 'click', x: 40, y: 20 }], tabId: '1', stopOnError: true },
  });
  assert.deepEqual(applied, [{ op: 'click', x: 20, y: 10 }]);
});

test('without a vision capture, coordinates are already CSS pixels and pass through', async () => {
  const applied: any[] = [];
  await handleExtensionCommand(new RefRegistry(), bridge(2, applied), {
    op: 'act',
    params: { actions: [{ op: 'click', x: 40, y: 20 }], stopOnError: true },
  });
  assert.deepEqual(applied, [{ op: 'click', x: 40, y: 20 }]);
});
