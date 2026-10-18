import {
  isNativeNoteImage,
  NOTE_IMAGE_SIZE_MESSAGE,
  toUploadableImage,
} from './note-image-convert';

export const NOTE_IMAGE_ACCEPT = 'image/*';
const MAX_NOTE_IMAGES = 4;
const MAX_NOTE_IMAGE_BYTES = 2 * 1024 * 1024;

export interface PendingImage {
  key: string;
  name: string;
  /** FileReader data URL; the server strips the `data:...;base64,` prefix. */
  dataUrl: string;
}

/** Returns an error message, or null when every file can be added. */
export function checkNoteImages(files: readonly File[], currentCount: number): string | null {
  if (currentCount + files.length > MAX_NOTE_IMAGES) {
    return `A note can have at most ${MAX_NOTE_IMAGES} images.`;
  }
  if (files.some((file) => !file.type.startsWith('image/'))) {
    return 'Only image files can be added.';
  }
  // Non-native types are measured after conversion, so only the final upload size counts.
  if (files.some((file) => file.size > MAX_NOTE_IMAGE_BYTES && isNativeNoteImage(file))) {
    return NOTE_IMAGE_SIZE_MESSAGE;
  }
  return null;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the image.'));
    reader.readAsDataURL(file);
  });
}

let sequence = 0;

export async function readNoteImages(files: readonly File[]): Promise<PendingImage[]> {
  const ready = await Promise.all(
    files.map((file) => toUploadableImage(file, MAX_NOTE_IMAGE_BYTES)),
  );
  return Promise.all(
    ready.map(async (file, index) => ({
      key: `pending-${++sequence}`,
      name: file.name || `pasted-${index + 1}`,
      dataUrl: await readAsDataUrl(file),
    })),
  );
}

export function notePreview(text: string, limit = 80): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}
