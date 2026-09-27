import { BrowserDriverError } from './driver.js';

/**
 * Longest edge of a vision screenshot, in image pixels.
 *
 * A vision image exists so a model can see layout and point at it - canvas
 * games, WebGL, remote desktops, anything with no DOM worth reading. That needs
 * the picture, not every device pixel of a Retina display. The desktop helper
 * caps its captures for the same reason (`helper/src/capture.rs`); the browser
 * allows a little more because web UI text is smaller than native chrome.
 */
export const MAX_VISION_EDGE = 1280;

/**
 * Largest `imageDataUri` a snapshot may carry, in characters.
 *
 * This is a transport limit before it is a token one. The image crosses two
 * framed hops - extension to worker (8 MiB frames) and worker to core (1 MiB
 * frames, `packages/ipc/src/framing.ts`) - inside a JSON result that also
 * carries the boxes. An unbounded PNG of a busy canvas passed neither: the
 * extension hop dropped the socket and the caller saw only a timeout. The
 * budget leaves the rest of the 1 MiB frame for the boxes and the envelope.
 */
export const MAX_VISION_IMAGE_CHARS = 640 * 1024;

/** Smallest longest-edge the ladder will shrink to before giving up. */
const MIN_VISION_EDGE = 480;

/**
 * Tried in order until one fits. Quality drops first, because shrinking costs
 * the model detail it may need to find a small target; size only goes after
 * lossy encoding alone has not been enough.
 */
const LADDER: ReadonlyArray<{ scale: number; quality: number }> = [
  { scale: 1, quality: 70 },
  { scale: 1, quality: 50 },
  { scale: 0.75, quality: 50 },
  { scale: 0.5, quality: 45 },
  { scale: 0.375, quality: 35 },
];

export interface VisionSize {
  width: number;
  height: number;
}

/** Encodes the current viewport at `size` image pixels; returns a data URI. */
export type VisionEncoder = (size: VisionSize, quality: number) => Promise<string>;

export interface VisionCapture {
  imageDataUri: string;
  /** Image pixels per CSS pixel. `cssX = imageX / devicePixelRatio`. */
  devicePixelRatio: number;
  /**
   * The encoded image's own size. A quality step leaves it alone; a size step
   * shrinks it. Stated outright so a caller never has to decode the image to
   * know the coordinate space its `{x, y}` are read in.
   */
  imageWidth: number;
  imageHeight: number;
  /** The visible viewport the image was taken of, in CSS pixels. */
  viewport: VisionSize;
}

/**
 * Captures the viewport as a JPEG that is guaranteed to fit the transport.
 *
 * `viewport` is the visible area in CSS pixels. The first attempt is at CSS
 * scale, capped to `MAX_VISION_EDGE`; each later attempt trades quality, then
 * size, until the payload fits `MAX_VISION_IMAGE_CHARS`. The reported ratio is
 * computed from the width actually encoded, so boxes and coordinate clicks
 * always agree with the picture the caller received.
 */
export async function captureWithinBudget(
  viewport: VisionSize,
  encode: VisionEncoder,
): Promise<VisionCapture> {
  const { width, height } = viewport;
  if (!(width > 0 && height > 0)) {
    throw new BrowserDriverError(
      'BROWSER_CAPTURE_FAILED',
      `vision capture needs a visible viewport, got ${width}x${height}`,
    );
  }
  const longest = Math.max(width, height);
  const base = Math.min(1, MAX_VISION_EDGE / longest);
  let smallest = Number.POSITIVE_INFINITY;
  for (const step of LADDER) {
    const scale = base * step.scale;
    if (longest * scale < MIN_VISION_EDGE && step.scale !== 1) break;
    const size = {
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale)),
    };
    const imageDataUri = await encode(size, step.quality);
    if (imageDataUri.length <= MAX_VISION_IMAGE_CHARS) {
      return {
        imageDataUri,
        devicePixelRatio: size.width / width,
        imageWidth: size.width,
        imageHeight: size.height,
        viewport: { width, height },
      };
    }
    smallest = Math.min(smallest, imageDataUri.length);
  }
  throw new BrowserDriverError(
    'BROWSER_CAPTURE_TOO_LARGE',
    `vision capture could not fit ${MAX_VISION_IMAGE_CHARS} characters (smallest attempt ${smallest})`,
  );
}
