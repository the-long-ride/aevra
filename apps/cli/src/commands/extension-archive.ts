import path from 'node:path';
import { inflateRawSync } from 'node:zlib';

export interface ArchiveEntry {
  name: string;
  data: Buffer;
}

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_FILE_HEADER = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;
const STORED = 0;
const DEFLATED = 8;
// The published extension is a few hundred kilobytes. This bounds what any
// archive can expand to in memory, because a deflate stream can inflate by
// three orders of magnitude and the compressed size alone says nothing about
// what it becomes.
const MAX_TOTAL_BYTES = 128 * 1024 * 1024;

// Duplicated from `scripts/lib/zip.mjs` rather than shared: the packaging
// scripts run before anything is compiled, so they cannot import from here, and
// a small table is a lighter cost than a build-order dependency.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function fail(message: string): Error {
  return Object.assign(new Error(message), { code: 'EXTENSION_ARCHIVE_INVALID' });
}

function carriesControlCharacters(name: string): boolean {
  return [...name].some((character) => character.charCodeAt(0) < 0x20);
}

/**
 * Rejects any entry name that could write outside the directory the user chose.
 * An archive is attacker-controlled input the moment it arrives over the
 * network, and "unzip wherever the paths say" is how an extension download turns
 * into arbitrary file placement.
 */
export function safeEntryPath(root: string, name: string): string {
  if (!name) throw fail('Archive entry has no name');
  // Backslash is not a ZIP path separator, so a name carrying one is either
  // malformed or an attempt to escape on Windows.
  if (name.includes('\\')) throw fail(`Archive entry uses a backslash: ${name}`);
  if (carriesControlCharacters(name)) {
    throw fail('Archive entry name carries control characters');
  }
  if (name.startsWith('/') || /^[A-Za-z]:/.test(name)) {
    throw fail(`Archive entry is an absolute path: ${name}`);
  }
  const segments = name.split('/');
  if (segments.some((segment) => segment === '..' || segment === '.')) {
    throw fail(`Archive entry escapes the destination: ${name}`);
  }

  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, ...segments);
  // Belt and braces: even with the segment checks above, the final path has to
  // land inside the root the caller named.
  if (target !== resolvedRoot && !target.startsWith(resolvedRoot + path.sep)) {
    throw fail(`Archive entry escapes the destination: ${name}`);
  }
  return target;
}

function endOfCentralDirectory(archive: Buffer): number {
  // The record is last, but a trailing comment can push it back by up to 64 KiB.
  const earliest = Math.max(0, archive.length - 22 - 0xffff);
  for (let at = archive.length - 22; at >= earliest; at -= 1) {
    if (archive.readUInt32LE(at) === END_OF_CENTRAL_DIRECTORY) return at;
  }
  throw fail('Downloaded file is not a zip archive');
}

/**
 * Inflation is bounded by the size the central directory declares, and the
 * result has to match it. Without that a small deflate stream could expand
 * until the process runs out of memory, and the archive's own header is the
 * only statement of intent available to check against.
 */
function decompress(method: number, body: Buffer, name: string, declaredSize: number): Buffer {
  if (method === STORED) return body;
  if (method === DEFLATED) {
    try {
      return inflateRawSync(body, { maxOutputLength: Math.max(declaredSize, 1) });
    } catch {
      throw fail(`Archive entry ${name} does not inflate to its declared size`);
    }
  }
  throw fail(`Archive entry ${name} uses unsupported compression ${method}`);
}

/**
 * Reads a ZIP into memory. Directory records are dropped: directories are
 * created from the file paths, so an archive cannot conjure an empty tree.
 */
export function readZipEntries(archive: Buffer): ArchiveEntry[] {
  if (archive.length < 22) throw fail('Downloaded file is not a zip archive');
  const end = endOfCentralDirectory(archive);
  const count = archive.readUInt16LE(end + 10);
  let at = archive.readUInt32LE(end + 16);

  const entries: ArchiveEntry[] = [];
  let total = 0;
  for (let index = 0; index < count; index += 1) {
    if (at + 46 > archive.length || archive.readUInt32LE(at) !== CENTRAL_FILE_HEADER) {
      throw fail('Archive central directory is malformed');
    }
    const method = archive.readUInt16LE(at + 10);
    const checksum = archive.readUInt32LE(at + 16);
    const compressedSize = archive.readUInt32LE(at + 20);
    const uncompressedSize = archive.readUInt32LE(at + 24);
    const nameLength = archive.readUInt16LE(at + 28);
    const extraLength = archive.readUInt16LE(at + 30);
    const commentLength = archive.readUInt16LE(at + 32);
    const localOffset = archive.readUInt32LE(at + 42);
    const name = archive.toString('utf8', at + 46, at + 46 + nameLength);
    at += 46 + nameLength + extraLength + commentLength;

    if (name.endsWith('/')) continue;

    const hasLocalHeader =
      localOffset + 30 <= archive.length && archive.readUInt32LE(localOffset) === LOCAL_FILE_HEADER;
    if (!hasLocalHeader) throw fail(`Archive entry ${name} has no local header`);

    const start =
      localOffset +
      30 +
      archive.readUInt16LE(localOffset + 26) +
      archive.readUInt16LE(localOffset + 28);
    if (start + compressedSize > archive.length) throw fail(`Archive entry ${name} is truncated`);

    total += uncompressedSize;
    if (total > MAX_TOTAL_BYTES) throw fail('Archive expands to more than Aevra will extract');

    const body = archive.subarray(start, start + compressedSize);
    const data = decompress(method, body, name, uncompressedSize);
    // The declared size is what the running total was checked against, so an
    // entry that inflates to something else has to be refused rather than
    // silently blowing past the budget.
    if (data.length !== uncompressedSize) throw fail(`Archive entry ${name} has a wrong size`);
    if (crc32(data) !== checksum) throw fail(`Archive entry ${name} failed its checksum`);
    entries.push({ name, data });
  }

  if (entries.length === 0) throw fail('Archive contains no files');
  return entries;
}
