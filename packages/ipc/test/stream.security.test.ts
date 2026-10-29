import assert from 'node:assert/strict';
import test from 'node:test';
import type { StreamContext } from '../src/stream-server.js';
import { defer, env, rawPeer, startRig } from './stream-helpers.js';

const b64 = (n: number) => Buffer.alloc(n, 65).toString('base64');

/** A server whose handler records how its upload ended. */
async function rigWithUploadHandler(consume: boolean) {
  const seen = defer<{ code?: string; bytes: number }>();
  const rig = await startRig({
    async execute(_e: any, ctx?: StreamContext) {
      let bytes = 0;
      if (!consume) {
        await new Promise(() => {});
      }
      try {
        for await (const c of ctx!.upload!) bytes += c.length;
        seen.resolve({ bytes });
      } catch (e) {
        seen.resolve({ code: (e as { code?: string }).code, bytes });
        throw e;
      }
      return { ok: true, value: bytes };
    },
  });
  return { rig, seen };
}

const openUpload = (peer: Awaited<ReturnType<typeof rawPeer>>, id = 's1', requestId = 'q1') => {
  peer.send({
    type: 'execute',
    requestId,
    envelope: env('sink'),
    stream: { id, direction: 'upload' },
  });
};

test('stream frames before the handshake close the socket', async () => {
  const { rig } = await rigWithUploadHandler(true);
  const peer = await rawPeer(rig, false);
  peer.send({ type: 'streamData', streamId: 's1', seq: 0, data: b64(10) });
  assert.equal(await peer.waitClosed(), true);
  await rig.close();
});

test('frames for an unknown stream are answered with STREAM_UNKNOWN', async () => {
  const { rig } = await rigWithUploadHandler(true);
  const peer = await rawPeer(rig);
  for (const type of ['streamOpen', 'streamData', 'streamEnd']) {
    peer.send({ type, streamId: 'nope', requestId: 'q1', seq: 0, data: b64(4), bytes: 4 });
    const abort = await peer.waitFor((f) => f.type === 'streamAbort' && f.streamId === 'nope');
    assert.equal(abort.code, 'STREAM_UNKNOWN');
    peer.frames.length = 0;
  }
  await rig.close();
});

test('streamOpen must carry the requestId of the verified envelope', async () => {
  const { rig, seen } = await rigWithUploadHandler(true);
  const peer = await rawPeer(rig);
  openUpload(peer);
  peer.send({ type: 'streamOpen', streamId: 's1', requestId: 'someone-else' });
  const abort = await peer.waitFor((f) => f.type === 'streamAbort');
  assert.equal(abort.code, 'STREAM_PROTOCOL');
  assert.equal((await seen.promise).code, 'STREAM_PROTOCOL');
  await rig.close();
});

test('a raw chunk over 512 KiB is rejected', async () => {
  const { rig, seen } = await rigWithUploadHandler(true);
  const peer = await rawPeer(rig);
  openUpload(peer);
  peer.send({ type: 'streamOpen', streamId: 's1', requestId: 'q1' });
  peer.send({ type: 'streamData', streamId: 's1', seq: 0, data: b64(600 * 1024) });
  const abort = await peer.waitFor((f) => f.type === 'streamAbort');
  assert.equal(abort.code, 'STREAM_CHUNK_TOO_LARGE');
  assert.equal((await seen.promise).code, 'STREAM_CHUNK_TOO_LARGE');
  await rig.close();
});

test('a byte count that disagrees with streamEnd is rejected', async () => {
  const { rig, seen } = await rigWithUploadHandler(true);
  const peer = await rawPeer(rig);
  openUpload(peer);
  peer.send({ type: 'streamOpen', streamId: 's1', requestId: 'q1' });
  peer.send({ type: 'streamData', streamId: 's1', seq: 0, data: b64(100) });
  peer.send({ type: 'streamEnd', streamId: 's1', bytes: 999 });
  const abort = await peer.waitFor((f) => f.type === 'streamAbort');
  assert.equal(abort.code, 'STREAM_LENGTH_MISMATCH');
  assert.equal((await seen.promise).code, 'STREAM_LENGTH_MISMATCH');
  await rig.close();
});

test('out-of-order chunks are rejected', async () => {
  const { rig, seen } = await rigWithUploadHandler(true);
  const peer = await rawPeer(rig);
  openUpload(peer);
  peer.send({ type: 'streamOpen', streamId: 's1', requestId: 'q1' });
  peer.send({ type: 'streamData', streamId: 's1', seq: 5, data: b64(10) });
  assert.equal((await peer.waitFor((f) => f.type === 'streamAbort')).code, 'STREAM_SEQUENCE');
  assert.equal((await seen.promise).code, 'STREAM_SEQUENCE');
  await rig.close();
});

test('a peer that ignores the ack window is cut off', async () => {
  const { rig } = await rigWithUploadHandler(false);
  const peer = await rawPeer(rig);
  openUpload(peer);
  peer.send({ type: 'streamOpen', streamId: 's1', requestId: 'q1' });
  for (let seq = 0; seq < 12; seq++) {
    peer.send({ type: 'streamData', streamId: 's1', seq, data: b64(1024) });
  }
  const abort = await peer.waitFor((f) => f.type === 'streamAbort');
  assert.equal(abort.code, 'STREAM_WINDOW');
  await rig.close();
});

test('data for a finished stream is treated as unknown', async () => {
  const { rig } = await rigWithUploadHandler(true);
  const peer = await rawPeer(rig);
  openUpload(peer);
  peer.send({ type: 'streamOpen', streamId: 's1', requestId: 'q1' });
  peer.send({ type: 'streamData', streamId: 's1', seq: 0, data: b64(10) });
  peer.send({ type: 'streamEnd', streamId: 's1', bytes: 10 });
  await peer.waitFor((f) => f.requestId === 'q1' && f.result);
  peer.send({ type: 'streamData', streamId: 's1', seq: 1, data: b64(10) });
  const abort = await peer.waitFor((f) => f.type === 'streamAbort');
  assert.equal(abort.code, 'STREAM_UNKNOWN');
  await rig.close();
});

test('a peer cannot push data into a download stream or reuse a live stream id', async () => {
  const { rig } = await rigWithUploadHandler(false);
  const peer = await rawPeer(rig);
  peer.send({
    type: 'execute',
    requestId: 'q1',
    envelope: env('source'),
    stream: { id: 'd1', direction: 'download' },
  });
  peer.send({ type: 'streamOpen', streamId: 'd1', requestId: 'q1' });
  const abort = await peer.waitFor((f) => f.type === 'streamAbort' && f.streamId === 'd1');
  assert.equal(abort.code, 'STREAM_PROTOCOL');

  openUpload(peer, 's2', 'q2');
  openUpload(peer, 's2', 'q3');
  const reply = await peer.waitFor((f) => f.requestId === 'q3' && f.error);
  assert.match(String(reply.error), /invalid stream/);
  await rig.close();
});
