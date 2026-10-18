export type NoteImageType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

export const NOTE_LIMITS = {
  titleMax: 80,
  textMax: 20_000,
  imagesPerNote: 4,
  imageBytesMax: 2 * 1024 * 1024,
  imageNameMax: 120,
  notesPerActor: 200,
} as const;

const NOTE_FIELDS = new Set([
  'title',
  'text',
  'keepImageIds',
  'addImages',
  'visibleToAi',
  'aiCanDelete',
  'readOnConnect',
]);
const AUTO_TITLE = /^note-(\d+)$/;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const DATA_URL = /^data:[^,]*;base64,/i;

export function invalidNote(message: string): Error {
  return Object.assign(new Error(message), { status: 400, code: 'INVALID_CONNECTOR_NOTE' });
}

export function noteNotFound(): Error {
  return Object.assign(new Error('Note not found.'), { status: 404, code: 'NOTE_NOT_FOUND' });
}

function startsWith(bytes: Uint8Array, signature: number[], offset = 0) {
  return signature.every((value, index) => bytes[offset + index] === value);
}
const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));

/** Decides the image type from content only. The declared type is never trusted. */
export function sniffImageType(bytes: Uint8Array): NoteImageType | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(bytes, ascii('GIF87a')) || startsWith(bytes, ascii('GIF89a'))) return 'image/gif';
  if (startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WEBP'), 8)) return 'image/webp';
  return null;
}

export interface ParsedImage {
  name: string | undefined;
  mimeType: NoteImageType;
  bytes: Buffer;
}

export interface ParsedNoteInput {
  title?: string;
  text?: string;
  keepImageIds?: string[];
  addImages: ParsedImage[];
  visibleToAi?: boolean;
  aiCanDelete?: boolean;
  readOnConnect?: boolean;
}

function parseImage(value: unknown, index: number): ParsedImage {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalidNote(`addImages[${index}] must be an object.`);
  }
  const source = value as Record<string, unknown>;
  for (const key of Object.keys(source)) {
    if (key !== 'name' && key !== 'dataBase64') throw invalidNote(`Unknown image field: ${key}.`);
  }
  let name: string | undefined;
  if (source.name !== undefined) {
    if (typeof source.name !== 'string') throw invalidNote('Image name must be text.');
    name = source.name.trim() || undefined;
    if (name && name.length > NOTE_LIMITS.imageNameMax) {
      throw invalidNote(`Image name must be at most ${NOTE_LIMITS.imageNameMax} characters.`);
    }
  }
  if (typeof source.dataBase64 !== 'string') throw invalidNote('Image dataBase64 is required.');
  const encoded = source.dataBase64.replace(DATA_URL, '').replace(/\s+/g, '');
  if (!encoded || encoded.length % 4 !== 0 || !BASE64.test(encoded)) {
    throw invalidNote('Image data must be base64.');
  }
  if ((encoded.length / 4) * 3 - 2 > NOTE_LIMITS.imageBytesMax) {
    throw invalidNote('Each image must be at most 2 MiB.');
  }
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length > NOTE_LIMITS.imageBytesMax)
    throw invalidNote('Each image must be at most 2 MiB.');
  const mimeType = sniffImageType(bytes);
  if (!mimeType) throw invalidNote('Images must be png, jpeg, gif or webp.');
  return { name, mimeType, bytes };
}

function optionalBoolean(source: Record<string, unknown>, key: string): boolean | undefined {
  const value = source[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw invalidNote(`${key} must be true or false.`);
  return value;
}

/** Validates shape and per-field limits. Cross-field rules are checked by the repository. */
export function parseNoteInput(input: unknown): ParsedNoteInput {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw invalidNote('Note must be an object.');
  }
  const source = input as Record<string, unknown>;
  for (const key of Object.keys(source)) {
    if (!NOTE_FIELDS.has(key)) throw invalidNote(`Unknown note field: ${key}.`);
  }
  const parsed: ParsedNoteInput = { addImages: [] };
  if (source.title !== undefined) {
    if (typeof source.title !== 'string') throw invalidNote('title must be text.');
    parsed.title = source.title.trim();
    if (parsed.title.length > NOTE_LIMITS.titleMax) {
      throw invalidNote(`title must be at most ${NOTE_LIMITS.titleMax} characters.`);
    }
  }
  if (source.text !== undefined) {
    if (typeof source.text !== 'string') throw invalidNote('text must be text.');
    if (source.text.length > NOTE_LIMITS.textMax) {
      throw invalidNote(`text must be at most ${NOTE_LIMITS.textMax} characters.`);
    }
    parsed.text = source.text;
  }
  if (source.keepImageIds !== undefined) {
    const ids = source.keepImageIds;
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) {
      throw invalidNote('keepImageIds must be a list of image ids.');
    }
    if (new Set(ids).size !== ids.length)
      throw invalidNote('keepImageIds has duplicate image ids.');
    parsed.keepImageIds = ids as string[];
  }
  if (source.addImages !== undefined) {
    if (!Array.isArray(source.addImages)) throw invalidNote('addImages must be a list.');
    if (source.addImages.length > NOTE_LIMITS.imagesPerNote) {
      throw invalidNote(`A note can have at most ${NOTE_LIMITS.imagesPerNote} images.`);
    }
    parsed.addImages = source.addImages.map(parseImage);
  }
  const visibleToAi = optionalBoolean(source, 'visibleToAi');
  if (visibleToAi !== undefined) parsed.visibleToAi = visibleToAi;
  const aiCanDelete = optionalBoolean(source, 'aiCanDelete');
  if (aiCanDelete !== undefined) parsed.aiCanDelete = aiCanDelete;
  const readOnConnect = optionalBoolean(source, 'readOnConnect');
  if (readOnConnect !== undefined) parsed.readOnConnect = readOnConnect;
  return parsed;
}

/** `note-N` with N one above the highest automatic number already used. */
export function nextAutoTitle(titles: readonly string[]): string {
  let highest = 0;
  for (const title of titles) {
    const match = AUTO_TITLE.exec(title);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return `note-${highest + 1}`;
}
