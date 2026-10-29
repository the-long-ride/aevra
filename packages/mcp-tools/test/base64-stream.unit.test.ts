import assert from 'node:assert/strict';
import test from 'node:test';
import { Base64Accumulator } from '../src/base64-stream.js';

function encode(data: Buffer, size: number) {
  const acc = new Base64Accumulator();
  for (let at = 0; at < data.length; at += size) acc.push(data.subarray(at, at + size));
  return acc.finish();
}

test('incremental base64 equals one-shot for chunk sizes not divisible by 3', () => {
  const data = Buffer.from(Array.from({ length: 1003 }, (_, i) => (i * 31 + 7) % 256));
  for (const size of [1, 2, 3, 4, 5, 7, 64, 100, 1002, 1003, 5000]) {
    assert.equal(encode(data, size), data.toString('base64'), `chunk size ${size}`);
  }
});

test('empty input encodes to the empty string', () => {
  assert.equal(new Base64Accumulator().finish(), '');
  assert.equal(encode(Buffer.alloc(0), 4), '');
});

test('pushed chunks may be reused afterwards', () => {
  const acc = new Base64Accumulator();
  const scratch = Buffer.from('abcd');
  acc.push(scratch);
  scratch.fill(0);
  acc.push(Buffer.from('e'));
  assert.equal(acc.finish(), Buffer.from('abcde').toString('base64'));
});
