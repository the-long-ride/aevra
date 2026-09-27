import type { BrowserBox, BrowserSnapshotNode } from '../../protocol/src/browser.js';
import type { CdpClient } from './cdp-client.js';
import { BrowserDriverError } from './driver.js';
import {
  captureWithinBudget,
  MAX_VISION_IMAGE_CHARS,
  type VisionCapture,
} from './vision-budget.js';

interface Viewport {
  pageX: number;
  pageY: number;
  clientWidth: number;
  clientHeight: number;
}

interface LayoutMetrics {
  cssVisualViewport?: Viewport;
  cssLayoutViewport?: Omit<Viewport, 'pageX' | 'pageY'>;
}

/**
 * Captures the visible viewport as a JPEG bounded by the shared vision budget.
 *
 * The clip pins the capture to CSS pixels, or below them when the viewport is
 * larger than the budget allows. That matters because vision mode hands a
 * model an image and a set of boxes and then accepts coordinates back:
 * `Page.captureScreenshot` defaults to device pixels while `DOM.getBoxModel`
 * and `Input.dispatchMouseEvent` are both in CSS pixels, so the reported ratio
 * is what lets the driver put a coordinate back where the model saw it.
 *
 * `fromSurface` reads the composited frame, so canvas and WebGL content is in
 * the picture; `captureBeyondViewport: false` keeps Chrome from laying out the
 * whole page first, which on a long document is the slow part.
 */
export async function captureViewport(client: CdpClient): Promise<VisionCapture> {
  const viewport = await viewportRect(client);
  if (!viewport) return captureUnclipped(client);
  return captureWithinBudget(viewport, async (size, quality) => {
    const shot = await client.send<{ data: string }>('Page.captureScreenshot', {
      format: 'jpeg',
      quality,
      fromSurface: true,
      captureBeyondViewport: false,
      clip: { ...viewport, scale: size.width / viewport.width },
    });
    return `data:image/jpeg;base64,${shot.data}`;
  });
}

/**
 * Metrics can be unavailable - a crashed renderer, an interstitial. A picture
 * at the browser's own scale still beats no picture, as long as it fits.
 */
async function captureUnclipped(client: CdpClient): Promise<VisionCapture> {
  const shot = await client.send<{ data: string }>('Page.captureScreenshot', {
    format: 'jpeg',
    quality: 50,
    fromSurface: true,
    captureBeyondViewport: false,
  });
  const imageDataUri = `data:image/jpeg;base64,${shot.data}`;
  if (imageDataUri.length > MAX_VISION_IMAGE_CHARS) {
    throw new BrowserDriverError(
      'BROWSER_CAPTURE_TOO_LARGE',
      'vision capture without layout metrics exceeded the transport budget',
    );
  }
  // With no metrics the image itself is the only honest source of its size,
  // and at the browser's own scale it is also the best guess at the viewport.
  const size = jpegSize(shot.data);
  if (!size) {
    throw new BrowserDriverError('BROWSER_CAPTURE_FAILED', 'vision capture is not a JPEG');
  }
  return {
    imageDataUri,
    devicePixelRatio: 1,
    imageWidth: size.width,
    imageHeight: size.height,
    viewport: size,
  };
}

/**
 * Reads the frame size from a JPEG's start-of-frame segment. Walks segment
 * headers only, so it never decodes pixels; returns null for anything that is
 * not a well-formed JPEG header.
 */
function jpegSize(base64: string): { width: number; height: number } | null {
  const bytes = Buffer.from(base64, 'base64');
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1]!;
    // SOF0-SOF15 carry the size; C4 (DHT), C8 (JPG) and CC (DAC) share the range but do not.
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
    }
    offset += 2 + bytes.readUInt16BE(offset + 2);
  }
  return null;
}

async function viewportRect(client: CdpClient) {
  try {
    const metrics = await client.send<LayoutMetrics>('Page.getLayoutMetrics');
    const visual = metrics.cssVisualViewport;
    const layout = metrics.cssLayoutViewport;
    const width = visual?.clientWidth ?? layout?.clientWidth ?? 0;
    const height = visual?.clientHeight ?? layout?.clientHeight ?? 0;
    if (!(width > 0 && height > 0)) return null;
    return { x: visual?.pageX ?? 0, y: visual?.pageY ?? 0, width, height };
  } catch {
    return null;
  }
}

/**
 * Boxes come back from CDP in CSS pixels, while the image may have been
 * downscaled to fit the transport. Scaling them into the image's space is what
 * lets a model point at what it sees. A node whose box cannot be resolved is
 * simply not labelled.
 */
export async function scaledBoxes(
  nodes: BrowserSnapshotNode[],
  boxAt: (index: number) => Promise<BrowserBox>,
  scale: number,
): Promise<Array<{ ref: string; label: string; box: BrowserBox }>> {
  const boxes: Array<{ ref: string; label: string; box: BrowserBox }> = [];
  for (let index = 0; index < nodes.length; index += 1) {
    const box = await boxAt(index).catch(() => null);
    if (!box) continue;
    boxes.push({
      ref: nodes[index]!.ref,
      label: nodes[index]!.name,
      box: {
        x: box.x * scale,
        y: box.y * scale,
        width: box.width * scale,
        height: box.height * scale,
      },
    });
  }
  return boxes;
}

/** Action coordinates are read off the last vision image, in its pixel space. */
export function cssPoint(point: { x: number; y: number }, scale: number) {
  return { x: point.x / scale, y: point.y / scale };
}

/** Both ends of a drag share the tab's last screenshot scale. */
export function cssDragPoints(
  action: { x: number; y: number; toX: number; toY: number },
  scale: number,
): [{ x: number; y: number }, { x: number; y: number }] {
  return [cssPoint(action, scale), cssPoint({ x: action.toX, y: action.toY }, scale)];
}
