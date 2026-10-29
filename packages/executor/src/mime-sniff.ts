const OOXML = {
  'word/': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'xl/': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'ppt/': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
} as const;

function startsWith(head: Uint8Array, signature: number[], at = 0) {
  if (head.length < at + signature.length) return false;
  return signature.every((byte, index) => head[at + index] === byte);
}

function ascii(head: Uint8Array, at: number, text: string) {
  return startsWith(
    head,
    [...text].map((c) => c.charCodeAt(0)),
    at,
  );
}

/** Zip entry names sit in local file headers, so a substring scan of the first chunk finds them. */
function sniffZip(head: Uint8Array) {
  const text = Buffer.from(head.buffer, head.byteOffset, head.byteLength).toString('latin1');
  for (const [prefix, mime] of Object.entries(OOXML)) {
    if (text.includes(prefix)) return mime;
  }
  return 'application/zip';
}

/**
 * Names a file type from its first bytes, or returns null when unsure. Pass at
 * least the first 4 KiB so Office documents can be told apart from plain zips.
 */
export function sniffMime(head: Uint8Array): string | null {
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(head, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (ascii(head, 0, 'GIF87a') || ascii(head, 0, 'GIF89a')) return 'image/gif';
  if (ascii(head, 0, 'RIFF') && ascii(head, 8, 'WEBP')) return 'image/webp';
  if (ascii(head, 0, '%PDF-')) return 'application/pdf';
  if (ascii(head, 0, 'BLENDER')) return 'application/x-blender';
  if (startsWith(head, [0x50, 0x4b, 0x03, 0x04])) return sniffZip(head);
  return null;
}
