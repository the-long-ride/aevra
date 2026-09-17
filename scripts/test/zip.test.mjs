import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';
import test from 'node:test';
import { crc32, storeZip } from '../lib/zip.mjs';

test('crc32 matches the known checksum for a fixed input', () => {
  assert.equal(crc32(Buffer.from('hello')), 0x3610a686);
  assert.equal(crc32(Buffer.alloc(0)), 0);
});

test('a stored zip carries the local and central signatures and an entry count', () => {
  const zip = storeZip([{ name: 'manifest.json', data: Buffer.from('{}') }]);
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  const end = zip.length - 22;
  assert.equal(zip.readUInt32LE(end), 0x06054b50);
  assert.equal(zip.readUInt16LE(end + 10), 1);
});

test('entries are stored uncompressed so the archive needs no inflate to read', () => {
  const payload = Buffer.from('x'.repeat(200));
  const zip = storeZip([{ name: 'a.js', data: payload }]);
  assert.equal(zip.readUInt16LE(8), 0, 'compression method must be store');
  assert.equal(zip.readUInt32LE(18), payload.length);
  assert.equal(zip.readUInt32LE(22), payload.length);
  assert.ok(zip.includes(payload), 'the payload must appear verbatim');
});

test('the recorded checksum is the checksum of the stored bytes', () => {
  const payload = Buffer.from('console.log(1);\n');
  const zip = storeZip([{ name: 'a.js', data: payload }]);
  assert.equal(zip.readUInt32LE(14), crc32(payload));
});

test('the same input always produces byte-identical output', () => {
  const entries = [
    { name: 'b.js', data: Buffer.from('b') },
    { name: 'a.js', data: Buffer.from('a') },
  ];
  assert.deepEqual(storeZip(entries), storeZip(entries));
});

test('entry order does not change the archive', () => {
  const first = storeZip([
    { name: 'a.js', data: Buffer.from('a') },
    { name: 'b.js', data: Buffer.from('b') },
  ]);
  const second = storeZip([
    { name: 'b.js', data: Buffer.from('b') },
    { name: 'a.js', data: Buffer.from('a') },
  ]);
  assert.deepEqual(first, second);
});

test('an empty archive is still a valid zip', () => {
  const zip = storeZip([]);
  assert.equal(zip.length, 22);
  assert.equal(zip.readUInt32LE(0), 0x06054b50);
  assert.equal(zip.readUInt16LE(10), 0);
});

test('nested paths keep forward slashes, which is what unzip tools expect', () => {
  const zip = storeZip([
    { name: 'aevra-extension/apps/extension/src/service-worker.js', data: Buffer.from('sw') },
  ]);
  assert.ok(zip.includes(Buffer.from('aevra-extension/apps/extension/src/service-worker.js')));
});

test('stored entries are readable without an inflate pass', () => {
  // Pins the reason for storing rather than deflating: reading back needs no
  // decompression, and a deflate of the same bytes would not match.
  const payload = Buffer.from('{"manifest_version":3}');
  const zip = storeZip([{ name: 'manifest.json', data: payload }]);
  const nameLength = zip.readUInt16LE(26);
  const extraLength = zip.readUInt16LE(28);
  const start = 30 + nameLength + extraLength;
  assert.deepEqual(zip.subarray(start, start + payload.length), payload);
  assert.throws(() => inflateRawSync(payload));
});
