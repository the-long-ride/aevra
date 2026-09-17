import type { CdpClient } from './cdp-client.js';

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

export interface ViewportCapture {
  imageDataUri: string;
  devicePixelRatio: number;
}

/**
 * Captures the viewport at CSS scale rather than at the display's device pixel
 * ratio.
 *
 * It matters because vision mode hands a model an image and a set of boxes and
 * then accepts coordinates back. `Page.captureScreenshot` defaults to device
 * pixels while `DOM.getBoxModel` and `Input.dispatchMouseEvent` are both in CSS
 * pixels, so on any HiDPI display the picture and the coordinate space silently
 * disagree by the ratio - every coordinate click lands short. Pinning
 * `clip.scale` to 1 collapses the two spaces into one and makes the reported
 * ratio honestly 1.
 */
export async function captureViewport(client: CdpClient): Promise<ViewportCapture> {
  const clip = await viewportClip(client);
  const shot = await client.send<{ data: string }>('Page.captureScreenshot', {
    format: 'png',
    ...(clip ? { clip } : {}),
  });
  return { imageDataUri: `data:image/png;base64,${shot.data}`, devicePixelRatio: 1 };
}

/**
 * Returns null when the metrics are unavailable or degenerate, in which case the
 * caller falls back to an unclipped capture: a picture at the wrong scale still
 * beats no picture, and the reported ratio of 1 is then the browser's own.
 */
async function viewportClip(client: CdpClient) {
  try {
    const metrics = await client.send<LayoutMetrics>('Page.getLayoutMetrics');
    const visual = metrics.cssVisualViewport;
    const layout = metrics.cssLayoutViewport;
    const width = visual?.clientWidth ?? layout?.clientWidth ?? 0;
    const height = visual?.clientHeight ?? layout?.clientHeight ?? 0;
    if (!(width > 0 && height > 0)) return null;
    return { x: visual?.pageX ?? 0, y: visual?.pageY ?? 0, width, height, scale: 1 };
  } catch {
    return null;
  }
}
