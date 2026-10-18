/** Types the backend and MCP clients accept; anything else is re-encoded in the browser. */
const NATIVE_NOTE_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

export function isNativeNoteImage(file: File): boolean {
  return NATIVE_NOTE_IMAGE_TYPES.includes(file.type);
}

export const NOTE_IMAGE_SIZE_MESSAGE = 'Each image must be 2 MiB or smaller.';

interface Drawable {
  source: CanvasImageSource;
  width: number;
  height: number;
  release(): void;
}

function decodeImage(file: File): Promise<Drawable> {
  const viaElement = async (): Promise<Drawable> => {
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error('decode failed'));
        image.src = url;
      });
      return {
        source: image,
        // An SVG without intrinsic size reports 0; give the canvas something to draw on.
        width: image.naturalWidth || 512,
        height: image.naturalHeight || 512,
        release: () => URL.revokeObjectURL(url),
      };
    } catch (cause) {
      URL.revokeObjectURL(url);
      throw cause;
    }
  };
  if (typeof createImageBitmap !== 'function') return viaElement();
  return createImageBitmap(file).then(
    (bitmap): Drawable => ({
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      release: () => bitmap.close?.(),
    }),
    viaElement,
  );
}

function canvasBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

function renamed(name: string, extension: string): string {
  return name ? `${name.replace(/\.[^./\\]+$/, '')}.${extension}` : name;
}

/**
 * Returns a file the server accepts: native types pass through, any other image type is
 * decoded and re-encoded to PNG (JPEG q0.9 when the PNG is over `maxBytes`).
 */
export async function toUploadableImage(file: File, maxBytes: number): Promise<File> {
  if (isNativeNoteImage(file)) return file;
  const unreadable = new Error(
    `Can't read ${file.name || 'this image'} in this browser. Try PNG, JPEG, GIF or WebP.`,
  );
  let drawable: Drawable | null = null;
  try {
    drawable = await decodeImage(file);
    const canvas = document.createElement('canvas');
    canvas.width = drawable.width;
    canvas.height = drawable.height;
    const context = canvas.getContext('2d');
    if (!context) throw unreadable;
    context.drawImage(drawable.source, 0, 0);
    const png = await canvasBlob(canvas, 'image/png');
    if (!png) throw unreadable;
    if (png.size <= maxBytes) {
      return new File([png], renamed(file.name, 'png'), { type: 'image/png' });
    }
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(drawable.source, 0, 0);
    const jpeg = await canvasBlob(canvas, 'image/jpeg', 0.9);
    if (!jpeg) throw unreadable;
    if (jpeg.size > maxBytes) throw new Error(NOTE_IMAGE_SIZE_MESSAGE);
    return new File([jpeg], renamed(file.name, 'jpg'), { type: 'image/jpeg' });
  } catch (cause) {
    if (cause instanceof Error && cause.message === NOTE_IMAGE_SIZE_MESSAGE) throw cause;
    throw unreadable;
  } finally {
    drawable?.release();
  }
}
