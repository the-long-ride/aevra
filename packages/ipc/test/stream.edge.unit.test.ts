import assert from 'node:assert/strict';
import test from 'node:test';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { SocketWorkerClient } from '../src/client.js';
import { encodeFrame, FrameDecoder } from '../src/framing.js';
import { handshakeMac } from '../src/envelope.js';
import { runDownload, runUpload, type StreamHost } from '../src/stream-client.js';
import type { StreamContext } from '../src/stream-server.js';
import { StreamTable } from '../src/stream-table.js';
import { defer, env, MiB, SECRET, sleep, startRig } from './stream-helpers.js';

const ok = (value: unknown) => ({ ok: true, value });
const codeOf = (e: unknown) => (e as { code?: string }).code;

test('overlapping ctx.download calls deliver bytes in call order', async () => {
  const rig = await startRig({
    async execute(_e: any, ctx?: StreamContext) {
      const a = ctx!.download!(Buffer.alloc(3 * MiB, 1));
      const b = ctx!.download!(Buffer.alloc(3 * MiB, 2));
      await Promise.all([a, b]);
      return ok('sent');
    },
  });
  const { result, body } = await rig.client.executeWithDownload(env('source'));
  const firstByteOfEachChunk: number[] = [];
  for await (const c of body) {
    assert.ok(
      c.every((v) => v === c[0]),
      'a chunk mixes bytes of two sends',
    );
    firstByteOfEachChunk.push(c[0]!);
  }
  assert.deepEqual(firstByteOfEachChunk, [1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2]);
  assert.deepEqual(await result, ok('sent'));
  await rig.close();
});

test('an un-awaited ctx.download still finishes before the stream ends', async () => {
  const rig = await startRig({
    async execute(_e: any, ctx?: StreamContext) {
      void ctx!.download!(Buffer.alloc(3 * MiB, 7));
      return ok('sent');
    },
  });
  const { result, body } = await rig.client.executeWithDownload(env('source'));
  let bytes = 0;
  for await (const c of body) bytes += c.length;
  assert.equal(bytes, 3 * MiB);
  assert.deepEqual(await result, ok('sent'));
  await rig.close();
});

test('a failed stream wakes every queued ctx.download', async () => {
  const settled = defer<PromiseSettledResult<void>[]>();
  const rig = await startRig({
    async execute(_e: any, ctx?: StreamContext) {
      const a = ctx!.download!(Buffer.alloc(50 * MiB, 1));
      const b = ctx!.download!(Buffer.alloc(50 * MiB, 2));
      settled.resolve(await Promise.allSettled([a, b]));
      return ok('done');
    },
  });
  const { body } = await rig.client.executeWithDownload(env('source'));
  for await (const _c of body) break;
  const outcome = await Promise.race([settled.promise, sleep(3000).then(() => 'hung' as const)]);
  assert.notEqual(outcome, 'hung', 'a queued download was never woken by the abort');
  for (const r of outcome as PromiseSettledResult<void>[]) {
    assert.equal(r.status, 'rejected');
    assert.equal(codeOf((r as PromiseRejectedResult).reason), 'STREAM_CANCELLED');
  }
  await rig.close();
});

function fakeHost(reply: unknown) {
  const table = new StreamTable({ write: () => true, drain: async () => {} });
  const ids: string[] = [];
  const host: StreamHost = {
    table,
    reject: () => {},
    start: async (_type, build) => {
      ids.push((build('r1') as any).stream.id);
      return { requestId: 'r1', reply: Promise.resolve(reply) };
    },
  };
  return { host, table, ids };
}

test('an error reply with no prior abort closes the client stream entry', async () => {
  const down = fakeHost({ requestId: 'r1', error: 'boom' });
  await assert.rejects(runDownload(down.host, env('x'), 1000), /boom/);
  assert.equal(down.table.has(down.ids[0]!), false);

  const up = fakeHost({ requestId: 'r1', error: 'boom' });
  async function* nothing(): AsyncGenerator<Uint8Array> {}
  await assert.rejects(runUpload(up.host, env('x'), nothing(), 1000), /boom/);
  assert.equal(up.table.has(up.ids[0]!), false);
});

test('stream frames sent before the handshake completes are ignored', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'aevra-stream-rogue-'));
  const endpoint =
    process.platform === 'win32'
      ? `\\\\.\\pipe\\aevra-rogue-${Date.now()}-${Math.random().toString(36).slice(2)}`
      : path.join(dir, 'r.sock');
  const received: any[] = [];
  const server = net.createServer((socket) => {
    const decoder = new FrameDecoder();
    socket.on('error', () => {});
    socket.on('data', (chunk) => {
      for (const f of decoder.push(chunk) as any[]) {
        received.push(f);
        if (f.type !== 'hello') continue;
        // Unsolicited stream data first, then a genuine helloAck.
        socket.write(encodeFrame({ type: 'streamData', streamId: 'x', seq: 0, data: '' }));
        const challengeB = 'bb';
        socket.write(
          encodeFrame({
            type: 'helloAck',
            daemonInstanceId: 'd',
            challengeA: f.challengeA,
            challengeB,
            mac: handshakeMac(SECRET, 'd', f.challengeA, challengeB),
          }),
        );
      }
    });
  });
  await new Promise<void>((res, rej) => {
    server.once('error', rej);
    server.listen(endpoint, res);
  });
  const client = new SocketWorkerClient(endpoint, SECRET, 'd');
  await client.connect();
  await sleep(100);
  assert.deepEqual(
    received.map((f) => f.type),
    ['hello', 'ready'],
  );
  await client.close();
  await new Promise<void>((res) => server.close(() => res()));
  rmSync(dir, { recursive: true, force: true });
});

test('FrameDecoder handles split headers, coalesced frames with partial tails, and empty chunks', () => {
  const decoder = new FrameDecoder();
  const f1 = encodeFrame({ a: 1 });
  const f2 = encodeFrame({ b: 'two' });

  assert.deepEqual(decoder.push(Buffer.alloc(0)), []);
  assert.deepEqual(decoder.push(f1.subarray(0, 2)), []);
  assert.deepEqual(decoder.push(f1.subarray(2, 4)), []);
  assert.deepEqual(decoder.push(Buffer.concat([f1.subarray(4), f2.subarray(0, 6)])), [{ a: 1 }]);
  assert.deepEqual(decoder.push(f2.subarray(6)), [{ b: 'two' }]);
});
