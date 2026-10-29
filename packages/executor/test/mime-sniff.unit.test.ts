import assert from 'node:assert/strict';
import test from 'node:test';
import { sniffMime } from '../src/mime-sniff.js';

const bytes = (...parts: Array<number[] | string>) =>
  Uint8Array.from(
    parts.flatMap((part) => (typeof part === 'string' ? [...Buffer.from(part, 'latin1')] : part)),
  );

function zipWith(name: string) {
  // Local file header: signature, 26 header bytes, then the entry name.
  const header = new Array<number>(26).fill(0);
  return bytes([0x50, 0x4b, 0x03, 0x04], header, name, new Array<number>(64).fill(7));
}

test('sniffMime recognises the supported signatures', () => {
  const table: Array<[string, Uint8Array, string]> = [
    ['png', bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'rest'), 'image/png'],
    ['jpeg', bytes([0xff, 0xd8, 0xff, 0xe0], 'JFIF'), 'image/jpeg'],
    ['gif87', bytes('GIF87a', 'rest'), 'image/gif'],
    ['gif89', bytes('GIF89a', 'rest'), 'image/gif'],
    ['webp', bytes('RIFF', [1, 2, 3, 4], 'WEBPVP8 '), 'image/webp'],
    ['pdf', bytes('%PDF-1.7\n'), 'application/pdf'],
    ['blend', bytes('BLENDER-v305', 'rest'), 'application/x-blender'],
    ['zip', zipWith('notes.txt'), 'application/zip'],
    [
      'docx',
      zipWith('word/document.xml'),
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ],
    [
      'xlsx',
      zipWith('xl/workbook.xml'),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ],
    [
      'pptx',
      zipWith('ppt/presentation.xml'),
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ],
  ];
  for (const [name, head, expected] of table) assert.equal(sniffMime(head), expected, name);
});

test('sniffMime returns null for unknown or too-short input', () => {
  assert.equal(sniffMime(bytes('plain words here')), null);
  assert.equal(sniffMime(new Uint8Array()), null);
  assert.equal(sniffMime(bytes('RIFF', [1, 2, 3, 4], 'WAVEfmt ')), null);
  assert.equal(sniffMime(bytes([0x89, 0x50])), null);
});
