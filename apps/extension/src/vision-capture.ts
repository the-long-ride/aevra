import {
  captureWithinBudget,
  type VisionCapture,
  type VisionSize,
} from '../../../packages/browser/src/vision-budget.js';

/**
 * `captureVisibleTab` has no size or scale control: it returns the visible
 * area at the display's device pixel ratio, so a 2560x1440 canvas game on a 2x
 * display is a 5120x2880 frame. Sent as-is that frame outgrew the socket to
 * the worker and the snapshot surfaced as a bare timeout.
 *
 * So the frame is decoded once here, in the service worker, and re-encoded
 * through the shared budget ladder - the same one the CDP transport uses - at
 * CSS scale or below. The tab's viewport dimensions come from Chrome's tab
 * metadata, so taking a screenshot does not wait for a script in the page.
 */
export async function fitVisibleCapture(
  frameDataUri: string,
  tabViewport: VisionSize | null,
): Promise<VisionCapture> {
  const bitmap = await createImageBitmap(dataUriToBlob(frameDataUri));
  try {
    const viewport =
      tabViewport?.width && tabViewport.height
        ? tabViewport
        : { width: bitmap.width, height: bitmap.height };
    return await captureWithinBudget(viewport, async (size, quality) => {
      const canvas = new OffscreenCanvas(size.width, size.height);
      const context = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
      // Area-averaged rather than point-sampled: a downscaled UI is mostly
      // one-pixel strokes, and point sampling drops them.
      context.imageSmoothingQuality = 'high';
      context.drawImage(bitmap, 0, 0, size.width, size.height);
      const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: quality / 100 });
      return `data:image/jpeg;base64,${base64(new Uint8Array(await blob.arrayBuffer()))}`;
    });
  } finally {
    bitmap.close();
  }
}

function dataUriToBlob(uri: string): Blob {
  const comma = uri.indexOf(',');
  const type = /^data:([^;,]+)/.exec(uri)?.[1] ?? 'image/png';
  const binary = atob(uri.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type });
}

/** Chunked, because spreading a multi-megabyte array into one call overflows the stack. */
function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}
