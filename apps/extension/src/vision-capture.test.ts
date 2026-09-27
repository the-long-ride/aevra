import { afterEach, describe, expect, it, vi } from 'vitest';
import { fitVisibleCapture } from './vision-capture';

interface Drawn {
  width: number;
  height: number;
  quality: number | undefined;
}

/**
 * jsdom has neither `createImageBitmap` nor `OffscreenCanvas`, so both are
 * faked: the bitmap reports the captured frame's device-pixel size, and every
 * encode yields `bytesPerPixel` bytes per output pixel so the budget ladder is
 * exercised the way a real JPEG would drive it.
 */
function installCanvas(frame: { width: number; height: number }, bytesPerPixel: number) {
  const drawn: Drawn[] = [];
  const closed = { value: false };
  vi.stubGlobal('createImageBitmap', async () => ({
    ...frame,
    close: () => {
      closed.value = true;
    },
  }));
  vi.stubGlobal(
    'OffscreenCanvas',
    class {
      constructor(
        readonly width: number,
        readonly height: number,
      ) {}
      getContext() {
        return { drawImage: () => undefined, imageSmoothingQuality: 'low' };
      }
      async convertToBlob(options: { type: string; quality?: number }) {
        drawn.push({ width: this.width, height: this.height, quality: options.quality });
        const bytes = new Uint8Array(Math.round(this.width * this.height * bytesPerPixel));
        // jsdom's Blob has no arrayBuffer(); the service worker's does.
        return { type: options.type, arrayBuffer: async () => bytes.buffer };
      }
    },
  );
  return { drawn, closed };
}

const SOURCE = `data:image/jpeg;base64,${btoa('frame')}`;

afterEach(() => vi.unstubAllGlobals());

describe('fitVisibleCapture', () => {
  it('returns the viewport at CSS scale, so image pixels equal CSS pixels', async () => {
    const { drawn } = installCanvas({ width: 1600, height: 1000 }, 0.05);
    const shot = await fitVisibleCapture(SOURCE, { width: 800, height: 500 });
    expect(drawn[0]).toMatchObject({ width: 800, height: 500 });
    expect(shot.devicePixelRatio).toBe(1);
    expect(shot.imageDataUri).toMatch(/^data:image\/jpeg;base64,/);
  });

  it('uses captured frame dimensions when tab viewport metadata is missing', async () => {
    const { drawn } = installCanvas({ width: 800, height: 500 }, 0.05);
    const shot = await fitVisibleCapture(SOURCE, null);
    expect(drawn[0]).toMatchObject({ width: 800, height: 500 });
    expect(shot.viewport).toEqual({ width: 800, height: 500 });
  });

  it('caps a large HiDPI canvas and reports the ratio it was encoded at', async () => {
    // A 2560x1440 CSS viewport on a 2x display: the frame the reported bug choked on.
    const { drawn, closed } = installCanvas({ width: 5120, height: 2880 }, 0.1);
    const shot = await fitVisibleCapture(SOURCE, { width: 2560, height: 1440 });
    expect(drawn[0]).toMatchObject({ width: 1280, height: 720 });
    expect(shot.devicePixelRatio).toBe(1280 / 2560);
    expect(shot).toMatchObject({
      imageWidth: 1280,
      imageHeight: 720,
      viewport: { width: 2560, height: 1440 },
    });
    expect(closed.value).toBe(true);
  });

  it('keeps stepping down until a busy frame fits the transport budget', async () => {
    const { drawn } = installCanvas({ width: 1920, height: 1080 }, 2);
    const shot = await fitVisibleCapture(SOURCE, { width: 1920, height: 1080 });
    expect(drawn.length).toBeGreaterThan(1);
    expect(shot.imageDataUri.length).toBeLessThanOrEqual(640 * 1024);
    expect(shot.devicePixelRatio).toBe(drawn.at(-1)!.width / 1920);
  });

  it('releases the decoded frame even when nothing fits', async () => {
    const { closed } = installCanvas({ width: 1920, height: 1080 }, 8);
    await expect(fitVisibleCapture(SOURCE, { width: 1920, height: 1080 })).rejects.toMatchObject({
      code: 'BROWSER_CAPTURE_TOO_LARGE',
    });
    expect(closed.value).toBe(true);
  });
});
