import assert from 'node:assert/strict';
import test from 'node:test';
import {
  captureWithinBudget,
  MAX_VISION_EDGE,
  MAX_VISION_IMAGE_CHARS,
  type VisionEncoder,
} from '../src/vision-budget.js';

/** Payload grows with pixel area and quality, the way a real JPEG roughly does. */
function encoder(bytesPerPixelAtQ100: number, calls: Array<[number, number, number]> = []) {
  const encode: VisionEncoder = async (size, quality) => {
    calls.push([size.width, size.height, quality]);
    const chars = Math.round(size.width * size.height * bytesPerPixelAtQ100 * (quality / 100));
    return `data:image/jpeg;base64,${'A'.repeat(chars)}`;
  };
  return encode;
}

test('a viewport that already fits is captured at CSS scale in one encode', async () => {
  const calls: Array<[number, number, number]> = [];
  const shot = await captureWithinBudget({ width: 800, height: 600 }, encoder(0.2, calls));
  assert.equal(shot.devicePixelRatio, 1);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]!.slice(0, 2), [800, 600]);
  assert.match(shot.imageDataUri, /^data:image\/jpeg;base64,/);
});

test('a wide viewport is downscaled so its longest edge fits the cap', async () => {
  const calls: Array<[number, number, number]> = [];
  const shot = await captureWithinBudget({ width: 2560, height: 1440 }, encoder(0.2, calls));
  assert.equal(calls[0]![0], MAX_VISION_EDGE);
  assert.equal(calls[0]![1], 720);
  assert.equal(shot.devicePixelRatio, MAX_VISION_EDGE / 2560);
});

test('a busy frame steps down quality and size until the payload fits the budget', async () => {
  const calls: Array<[number, number, number]> = [];
  const shot = await captureWithinBudget({ width: 1920, height: 1080 }, encoder(3, calls));
  assert.ok(calls.length > 1, 'expected the ladder to retry');
  assert.ok(shot.imageDataUri.length <= MAX_VISION_IMAGE_CHARS);
  const [width] = calls.at(-1)!;
  assert.equal(shot.devicePixelRatio, width / 1920);
});

test('the reported ratio is derived from the width actually encoded', async () => {
  const shot = await captureWithinBudget({ width: 1366, height: 768 }, encoder(0.1));
  assert.equal(shot.devicePixelRatio, 1280 / 1366);
});

test('the capture reports the size it encoded and the viewport it came from', async () => {
  const shot = await captureWithinBudget({ width: 2560, height: 1440 }, encoder(0.2));
  assert.equal(shot.imageWidth, 1280);
  assert.equal(shot.imageHeight, 720);
  assert.deepEqual(shot.viewport, { width: 2560, height: 1440 });
});

test('a size step down is reflected in the reported image size, a quality step is not', async () => {
  const calls: Array<[number, number, number]> = [];
  const shot = await captureWithinBudget({ width: 1920, height: 1080 }, encoder(3, calls));
  const [width, height] = calls.at(-1)!;
  assert.equal(shot.imageWidth, width);
  assert.equal(shot.imageHeight, height);
  assert.deepEqual(shot.viewport, { width: 1920, height: 1080 });
});

test('a frame that cannot fit even at the floor fails loudly with a specific code', async () => {
  await assert.rejects(
    captureWithinBudget({ width: 1920, height: 1080 }, encoder(15)),
    (error: any) => error.code === 'BROWSER_CAPTURE_TOO_LARGE',
  );
});

test('a degenerate viewport is refused before any encode', async () => {
  const calls: Array<[number, number, number]> = [];
  await assert.rejects(
    captureWithinBudget({ width: 0, height: 600 }, encoder(0.2, calls)),
    (error: any) => error.code === 'BROWSER_CAPTURE_FAILED',
  );
  assert.equal(calls.length, 0);
});
