import assert from 'node:assert/strict';
import test from 'node:test';
import { acceptKey, encodeFrame, readFrames, WS_TEXT } from '../src/ws-server.js';

function roundTrip(payload: string, mask = false): string[] {
  return readFrames(encodeFrame(payload, mask)).frames.map((frame) => frame.text);
}

test('acceptKey follows the RFC 6455 handshake derivation', () => {
  assert.equal(acceptKey('dGhlIHNhbXBsZSBub25jZQ=='), 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
});

test('short, extended and 64-bit length frames all round-trip', () => {
  assert.deepEqual(roundTrip('hi'), ['hi']);
  const medium = 'x'.repeat(200);
  assert.deepEqual(roundTrip(medium), [medium]);
  const large = 'y'.repeat(70_000);
  assert.deepEqual(roundTrip(large), [large]);
});

test('a masked client frame decodes to the same payload', () => {
  assert.deepEqual(roundTrip('masked payload', true), ['masked payload']);
});

test('several frames in one chunk all decode', () => {
  const chunk = Buffer.concat([encodeFrame('one'), encodeFrame('two'), encodeFrame('three')]);
  assert.deepEqual(
    readFrames(chunk).frames.map((frame) => frame.text),
    ['one', 'two', 'three'],
  );
});

test('a split frame is held back until the rest arrives', () => {
  const whole = encodeFrame('split across chunks');
  const first = readFrames(whole.subarray(0, 6));
  assert.deepEqual(first.frames, []);
  assert.equal(first.rest.length, 6);

  const rejoined = readFrames(Buffer.concat([first.rest, whole.subarray(6)]));
  assert.deepEqual(
    rejoined.frames.map((frame) => frame.text),
    ['split across chunks'],
  );
  assert.equal(rejoined.rest.length, 0);
});

test('a split extended-length header is also held back', () => {
  const whole = encodeFrame('z'.repeat(300));
  const partial = readFrames(whole.subarray(0, 3));
  assert.deepEqual(partial.frames, []);
});

test('frames report their opcode so control frames can be told apart', () => {
  const [frame] = readFrames(encodeFrame('text')).frames;
  assert.equal(frame!.opcode, WS_TEXT);
});
