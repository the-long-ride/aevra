import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { deflateRawSync } from 'node:zlib';
import { readZipEntries, safeEntryPath } from '../src/commands/extension-archive.js';

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

interface ZipInput {
  name: string;
  data: Buffer;
  deflate?: boolean;
  method?: number;
  checksum?: number;
  /** Overrides the size the central directory claims the entry inflates to. */
  declaredSize?: number;
}

/**
 * Builds archives the reader has to cope with, including shapes the packaging
 * script never produces - deflated entries, directory records, a bad checksum.
 * Anyone can hand `aevra extension install` a zip, so the reader is tested
 * against more than its own writer.
 */
function buildZip(inputs: ZipInput[]): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const input of inputs) {
    const name = Buffer.from(input.name, 'utf8');
    const body = input.deflate ? deflateRawSync(input.data) : input.data;
    const method = input.method ?? (input.deflate ? 8 : 0);
    const checksum = input.checksum ?? crc32(input.data);

    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(method, 8);
    header.writeUInt32LE(checksum, 14);
    header.writeUInt32LE(body.length, 18);
    header.writeUInt32LE(input.data.length, 22);
    header.writeUInt16LE(name.length, 26);
    local.push(header, name, body);

    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0);
    directory.writeUInt16LE(method, 10);
    directory.writeUInt32LE(checksum, 16);
    directory.writeUInt32LE(body.length, 20);
    directory.writeUInt32LE(input.declaredSize ?? input.data.length, 24);
    directory.writeUInt16LE(name.length, 28);
    directory.writeUInt32LE(offset, 42);
    central.push(directory, name);

    offset += 30 + name.length + body.length;
  }

  const centralBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(inputs.length, 8);
  end.writeUInt16LE(inputs.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, centralBytes, end]);
}

test('a stored archive reads back its entries verbatim', () => {
  const zip = buildZip([
    { name: 'aevra-extension/manifest.json', data: Buffer.from('{"manifest_version":3}') },
    { name: 'aevra-extension/apps/extension/src/service-worker.js', data: Buffer.from('sw') },
  ]);
  const entries = readZipEntries(zip);
  assert.equal(entries.length, 2);
  assert.equal(String(entries[0]!.data), '{"manifest_version":3}');
});

test('a deflated entry is inflated rather than refused', () => {
  const payload = Buffer.from('x'.repeat(500));
  const entries = readZipEntries(
    buildZip([{ name: 'aevra-extension/big.js', data: payload, deflate: true }]),
  );
  assert.deepEqual(entries[0]!.data, payload);
});

test('directory records are dropped, so an archive cannot conjure empty folders', () => {
  const entries = readZipEntries(
    buildZip([
      { name: 'aevra-extension/', data: Buffer.alloc(0) },
      { name: 'aevra-extension/manifest.json', data: Buffer.from('{}') },
    ]),
  );
  assert.deepEqual(
    entries.map((entry) => entry.name),
    ['aevra-extension/manifest.json'],
  );
});

test('a corrupted entry is refused rather than written', () => {
  const zip = buildZip([{ name: 'aevra-extension/a.js', data: Buffer.from('hello'), checksum: 1 }]);
  assert.throws(() => readZipEntries(zip), /failed its checksum/);
});

test('an unsupported compression method is named rather than silently skipped', () => {
  const zip = buildZip([{ name: 'aevra-extension/a.js', data: Buffer.from('hello'), method: 12 }]);
  assert.throws(() => readZipEntries(zip), /unsupported compression 12/);
});

test('something that is not a zip is refused', () => {
  assert.throws(() => readZipEntries(Buffer.from('<!doctype html>')), /not a zip archive/);
  assert.throws(() => readZipEntries(Buffer.alloc(0)), /not a zip archive/);
});

test('an archive with no files is refused rather than reported as a success', () => {
  assert.throws(() => readZipEntries(buildZip([])), /no files/);
});

test('a truncated archive is refused', () => {
  const zip = buildZip([{ name: 'aevra-extension/a.js', data: Buffer.from('hello') }]);
  const broken = Buffer.concat([zip]);
  // Point the entry's compressed size past the end of the buffer.
  broken.writeUInt32LE(0xffff, 18);
  const centralAt = broken.length - 22 - 46 - 'aevra-extension/a.js'.length;
  broken.writeUInt32LE(0xffff, centralAt + 20);
  assert.throws(() => readZipEntries(broken), /truncated/);
});

test('an ordinary nested path resolves under the destination', () => {
  const root = path.resolve('/tmp/aevra-target');
  assert.equal(
    safeEntryPath(root, 'aevra-extension/apps/extension/src/bridge.js'),
    path.join(root, 'aevra-extension', 'apps', 'extension', 'src', 'bridge.js'),
  );
});

test('a traversing entry is refused, never written outside the destination', () => {
  const root = path.resolve('/tmp/aevra-target');
  assert.throws(() => safeEntryPath(root, '../escaped.js'), /escapes the destination/);
  assert.throws(
    () => safeEntryPath(root, 'aevra-extension/../../escaped.js'),
    /escapes the destination/,
  );
  assert.throws(() => safeEntryPath(root, './sneaky.js'), /escapes the destination/);
});

test('an absolute entry is refused on either platform convention', () => {
  const root = path.resolve('/tmp/aevra-target');
  assert.throws(() => safeEntryPath(root, '/etc/passwd'), /absolute path/);
  assert.throws(() => safeEntryPath(root, 'C:/Windows/System32/x.dll'), /absolute path/);
});

test('a backslash entry is refused, because it is not a zip path separator', () => {
  const root = path.resolve('/tmp/aevra-target');
  assert.throws(() => safeEntryPath(root, 'aevra-extension\\..\\escaped.js'), /backslash/);
});

test('an entry carrying control characters or no name is refused', () => {
  const root = path.resolve('/tmp/aevra-target');
  assert.throws(() => safeEntryPath(root, ''), /no name/);
  assert.throws(() => safeEntryPath(root, `a${String.fromCharCode(10)}b.js`), /control characters/);

  test('a deflate bomb is refused at its declared size, not inflated first', () => {
    // Declares 32 bytes, actually inflates to a megabyte. Without the bound this
    // is the shape that expands until the process runs out of memory.
    const zip = buildZip([
      {
        name: 'aevra-extension/bomb.js',
        data: Buffer.alloc(1024 * 1024, 0x41),
        deflate: true,
        declaredSize: 32,
      },
    ]);
    assert.throws(() => readZipEntries(zip), /does not inflate to its declared size/);
  });

  test('a stored entry that lies about its size is refused', () => {
    const zip = buildZip([
      { name: 'aevra-extension/a.js', data: Buffer.from('hello'), declaredSize: 4096 },
    ]);
    assert.throws(() => readZipEntries(zip), /wrong size/);
  });

  test('an archive claiming to expand past the extraction budget is refused', () => {
    // Refused on the declared size alone, before any inflation is attempted.
    const twoHundredMegabytes = 200 * 1024 * 1024;
    const zip = buildZip([
      { name: 'aevra-extension/a.js', data: Buffer.from('a'), declaredSize: twoHundredMegabytes },
    ]);
    assert.throws(() => readZipEntries(zip), /more than Aevra will extract/);
  });
});
