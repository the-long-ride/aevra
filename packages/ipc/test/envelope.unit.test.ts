import assert from 'node:assert/strict';
import test from 'node:test';
import { HmacEnvelopeSigner } from '../src/envelope.js';
const base = () => ({
  version: 1 as const,
  daemonInstanceId: 'd',
  operationId: 'o',
  sessionId: 's',
  workspaceId: 'w',
  issuedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  nonce: Math.random().toString(),
  executionMode: 'sandbox' as const,
  capabilityRoots: [],
  operation: { kind: 'sandbox.inspect' as const },
});
test('envelope rejects tamper expiry instance and replay', () => {
  const s = new HmacEnvelopeSigner(Buffer.alloc(32, 7), 'd');
  const e = s.sign(base());
  assert.equal(s.verify(e).operationId, 'o');
  assert.throws(() => s.verify(e), /replay/);
  const t = s.sign(base());
  assert.throws(() => s.verify({ ...t, workspaceId: 'x' }), /mac/);
  const expired = s.sign({
    ...base(),
    issuedAt: new Date(Date.now() - 2000).toISOString(),
    expiresAt: new Date(Date.now() - 1000).toISOString(),
  });
  assert.throws(() => s.verify(expired), /expired/);

  // Wrong daemon instance on sign and verify
  assert.throws(() => s.sign({ ...base(), daemonInstanceId: 'wrong-d' }), /wrong daemon instance/);
  const otherSigner = new HmacEnvelopeSigner(Buffer.alloc(32, 7), 'other-d');
  const otherEnv = otherSigner.sign({ ...base(), daemonInstanceId: 'other-d' });
  assert.throws(() => s.verify(otherEnv), /wrong daemon instance/);

  // Future-issued envelope
  const future = s.sign({
    ...base(),
    issuedAt: new Date(Date.now() + 100_000).toISOString(),
    expiresAt: new Date(Date.now() + 200_000).toISOString(),
  });
  assert.throws(() => s.verify(future), /future-issued envelope/);

  // Pruning seen nonces when time advances
  const oldNonceEnv = s.sign({
    ...base(),
    nonce: 'prunable-nonce',
    issuedAt: new Date(Date.now()).toISOString(),
    expiresAt: new Date(Date.now() + 1000).toISOString(),
  });
  s.verify(oldNonceEnv);
  // Advance time by 2000ms: prune() deletes oldNonce
  const freshEnv = s.sign({
    ...base(),
    nonce: 'fresh-nonce',
    issuedAt: new Date(Date.now() + 2000).toISOString(),
    expiresAt: new Date(Date.now() + 10_000).toISOString(),
  });
  s.verify(freshEnv, new Date(Date.now() + 2000));
});
test('envelope MAC survives JSON transport semantics for undefined values', () => {
  const secret = Buffer.alloc(32, 9),
    signer = new HmacEnvelopeSigner(secret, 'd');
  const envelope = signer.sign({
    ...base(),
    nonce: 'json-roundtrip',
    executionMode: 'host',
    operation: {
      kind: 'command.run',
      command: {
        executable: 'npm',
        args: ['test', undefined],
        env: { VISIBLE: '1', OMITTED: undefined },
        timeoutMs: undefined,
      },
    },
  } as any);
  const transported = JSON.parse(JSON.stringify(envelope));
  const verifier = new HmacEnvelopeSigner(secret, 'd');
  assert.equal(verifier.verify(transported).operationId, 'o');
  const tampered = structuredClone(transported);
  tampered.operation.command.executable = 'node';
  assert.throws(() => new HmacEnvelopeSigner(secret, 'd').verify(tampered), /mac/);
});

test('IPC frame encoding and decoding handles chunking and size limits', async () => {
  const { encodeFrame, FrameDecoder, MAX_FRAME_BYTES } = await import('../src/framing.js');
  const frame = encodeFrame({ msg: 'hello' });
  const decoder = new FrameDecoder();

  // Test fragmented chunks
  const part1 = frame.subarray(0, 3);
  const part2 = frame.subarray(3);
  assert.deepEqual(decoder.push(part1), []);
  assert.deepEqual(decoder.push(part2), [{ msg: 'hello' }]);

  // Test oversized encode
  const hugeString = 'x'.repeat(MAX_FRAME_BYTES + 10);
  assert.throws(() => encodeFrame({ data: hugeString }), /frame too large/);

  // Test oversized decode header
  const badHeader = Buffer.alloc(4);
  badHeader.writeUInt32BE(MAX_FRAME_BYTES + 10, 0);
  assert.throws(() => new FrameDecoder().push(badHeader), /frame too large/);

  const { handshakeMac } = await import('../src/envelope.js');
  const macResult = handshakeMac(Buffer.alloc(32, 1), 'client', 'nonce', '12345');
  assert.ok(typeof macResult === 'string' && macResult.length > 0);
});
