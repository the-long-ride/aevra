import assert from 'node:assert/strict';
import test from 'node:test';
import { deadlineForEnvelope, IPC_OVERHEAD_MS } from '../src/client.js';
import type { StreamContext } from '../src/stream-server.js';
import { STREAM_CHUNK_BYTES, StreamError } from '../src/stream.js';
import { defer, digestOf, env, generate, MiB, sleep, startRig } from './stream-helpers.js';

const ok = (value: unknown) => ({ ok: true, value });
const codeOf = (e: unknown) => (e as { code?: string }).code;

async function expectCode(p: Promise<unknown>, code: string) {
  await assert.rejects(p, (e: unknown) => {
    assert.equal(codeOf(e), code);
    return true;
  });
}

test('odd sizes, empty streams and oversized source chunks all arrive intact', async () => {
  const rig = await startRig({
    async execute(e: any, ctx?: StreamContext) {
      if (e.operation.kind === 'sink') return ok(await digestOf(ctx!.upload!));
      if (e.operation.kind === 'empty') return ok('nothing');
      for await (const c of generate(1_300_000, 700_000)) await ctx!.download!(c);
      return ok('sent');
    },
  });
  const want = await digestOf(generate(1_300_000, 700_000));
  const up = await rig.client.executeWithUpload(env('sink'), generate(1_300_000, 700_000));
  assert.deepEqual((up as any).value, want);
  const emptyUp = await rig.client.executeWithUpload(env('sink'), generate(0, 10));
  assert.deepEqual((emptyUp as any).value.bytes, 0);

  const down = await rig.client.executeWithDownload(env('source'));
  assert.deepEqual(await digestOf(down.body), want);
  assert.deepEqual(await down.result, ok('sent'));

  const none = await rig.client.executeWithDownload(env('empty'));
  assert.deepEqual(await digestOf(none.body), await digestOf(generate(0, 1)));
  assert.deepEqual(await none.result, ok('nothing'));
  await rig.close();
});

test('a small execute completes while an upload is mid-flight', async () => {
  const gate = defer<void>();
  const rig = await startRig({
    async execute(e: any, ctx?: StreamContext) {
      if (e.operation.kind === 'quick') return ok('quick');
      let n = 0;
      for await (const c of ctx!.upload!) {
        n += c.length;
        if (n >= STREAM_CHUNK_BYTES) await gate.promise;
      }
      return ok(n);
    },
  });
  const up = rig.client.executeWithUpload(env('sink'), generate(6 * MiB, 256 * 1024));
  await sleep(100);
  const started = Date.now();
  assert.deepEqual(await rig.client.execute(env('quick')), ok('quick'));
  assert.ok(Date.now() - started < 2000);
  gate.resolve();
  assert.deepEqual(await up, ok(6 * MiB));
  await rig.close();
});

test('a small execute completes while a download is mid-flight', async () => {
  const rig = await startRig({
    async execute(e: any, ctx?: StreamContext) {
      if (e.operation.kind === 'quick') return ok('quick');
      for await (const c of generate(6 * MiB, 256 * 1024)) await ctx!.download!(c);
      return ok('sent');
    },
  });
  const { result, body } = await rig.client.executeWithDownload(env('source'));
  await sleep(100);
  assert.deepEqual(await rig.client.execute(env('quick')), ok('quick'));
  assert.equal((await digestOf(body)).bytes, 6 * MiB);
  assert.deepEqual(await result, ok('sent'));
  await rig.close();
});

test('a failing source aborts both sides with the same code', async () => {
  const seen = defer<unknown>();
  const rig = await startRig({
    async execute(_e: any, ctx?: StreamContext) {
      try {
        for await (const _c of ctx!.upload!) void _c;
      } catch (e) {
        seen.resolve(e);
        throw e;
      }
      return ok('done');
    },
  });
  async function* bad() {
    yield* generate(MiB, 256 * 1024);
    throw new Error('disk gone');
  }
  await expectCode(rig.client.executeWithUpload(env('sink'), bad()), 'STREAM_SOURCE_ERROR');
  assert.equal(codeOf(await seen.promise), 'STREAM_SOURCE_ERROR');
  await rig.close();
});

test('a handler that aborts rejects the client upload and download with its code', async () => {
  const rig = await startRig({
    async execute(e: any, ctx?: StreamContext) {
      if (e.operation.kind === 'sink') {
        for await (const _c of ctx!.upload!) throw new StreamError('CAP_HIT');
        return ok('empty');
      }
      await ctx!.download!(Buffer.alloc(1000, 1));
      throw new StreamError('CAP_HIT');
    },
  });
  await expectCode(rig.client.executeWithUpload(env('sink'), generate(40 * MiB, MiB)), 'CAP_HIT');
  const { result, body } = await rig.client.executeWithDownload(env('source'));
  await expectCode(result, 'CAP_HIT');
  await expectCode(digestOf(body), 'CAP_HIT');
  await rig.close();
});

test('closing the client mid-stream fails both sides and the server cleans up', async () => {
  const seen = defer<unknown>();
  const rig = await startRig({
    async execute(_e: any, ctx?: StreamContext) {
      try {
        for await (const _c of ctx!.upload!) void _c;
      } catch (e) {
        seen.resolve(e);
        throw e;
      }
      return ok('done');
    },
  });
  async function* stalls() {
    yield* generate(MiB, 256 * 1024);
    await new Promise(() => {});
  }
  const up = rig.client.executeWithUpload(env('sink'), stalls());
  await sleep(150);
  await rig.client.close();
  await expectCode(up, 'WORKER_DISCONNECTED');
  assert.equal(codeOf(await seen.promise), 'WORKER_DISCONNECTED');
  await rig.close();
});

test('a timed-out upload aborts the server handler', async () => {
  const seen = defer<unknown>();
  const rig = await startRig({
    async execute(_e: any, ctx?: StreamContext) {
      try {
        for await (const _c of ctx!.upload!) void _c;
      } catch (e) {
        seen.resolve(e);
        throw e;
      }
      return ok('done');
    },
  });
  async function* stalls() {
    yield* generate(MiB, 256 * 1024);
    await new Promise(() => {});
  }
  await expectCode(
    rig.client.executeWithUpload(env('sink'), stalls(), { deadlineMs: 150 }),
    'WORKER_TIMEOUT',
  );
  assert.equal(codeOf(await seen.promise), 'WORKER_TIMEOUT');
  await rig.close();
});

test('a timed-out download aborts the server sender and the client body', async () => {
  const seen = defer<unknown>();
  const rig = await startRig({
    async execute(_e: any, ctx?: StreamContext) {
      try {
        for (;;) await ctx!.download!(Buffer.alloc(STREAM_CHUNK_BYTES, 2));
      } catch (e) {
        seen.resolve(e);
        throw e;
      }
    },
  });
  const { result, body } = await rig.client.executeWithDownload(env('source'), {
    deadlineMs: 150,
  });
  await expectCode(result, 'WORKER_TIMEOUT');
  await expectCode(digestOf(body), 'WORKER_TIMEOUT');
  assert.equal(codeOf(await seen.promise), 'WORKER_TIMEOUT');
  await rig.close();
});

test('abandoning a download body cancels the server sender', async () => {
  const seen = defer<unknown>();
  const rig = await startRig({
    async execute(_e: any, ctx?: StreamContext) {
      try {
        for (;;) await ctx!.download!(Buffer.alloc(STREAM_CHUNK_BYTES, 3));
      } catch (e) {
        seen.resolve(e);
        throw e;
      }
    },
  });
  const { result, body } = await rig.client.executeWithDownload(env('source'));
  for await (const _c of body) break;
  assert.equal(codeOf(await seen.promise), 'STREAM_CANCELLED');
  await expectCode(result, 'STREAM_CANCELLED');
  await rig.close();
});

test('a handler that ignores the upload still returns its result', async () => {
  const rig = await startRig({ execute: async () => ok('early') });
  const r = await rig.client.executeWithUpload(env('sink'), generate(40 * MiB, MiB));
  assert.deepEqual(r, ok('early'));
  assert.deepEqual(await rig.client.execute(env('quick')), ok('early'));
  await rig.close();
});

test('stream operations take their deadline from operation.timeoutMs', () => {
  assert.equal(
    deadlineForEnvelope(env('files.download', { timeoutMs: 600_000 })),
    600_000 + IPC_OVERHEAD_MS,
  );
});
