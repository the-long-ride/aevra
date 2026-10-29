import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import v8 from 'node:v8';
import vm from 'node:vm';
import type { StreamContext } from '../src/stream-server.js';
import { digestOf, env, generate, MiB, sleep, startRig } from './stream-helpers.js';

const LIMIT = 16 * MiB;

type Gc = (options?: { type: 'major'; execution: 'sync' }) => void;

/**
 * A baseline that holds only live memory. V8 sweeps freed ArrayBuffers lazily, so a
 * plain gc() can leave earlier garbage counted in `arrayBuffers`; two synchronous
 * major collections with a turn of the event loop between them let sweeping finish.
 */
async function settle(gc: Gc) {
  for (let i = 0; i < 2; i++) {
    gc({ type: 'major', execution: 'sync' });
    await sleep(20);
  }
}

async function sampler() {
  v8.setFlagsFromString('--expose-gc');
  const gc = vm.runInNewContext('gc') as Gc;
  await settle(gc);
  const base = process.memoryUsage().arrayBuffers;
  let peak = base;
  return {
    sample: () => {
      gc({ type: 'major', execution: 'sync' });
      peak = Math.max(peak, process.memoryUsage().arrayBuffers);
    },
    growth: () => peak - base,
    describe: () => `base=${base} peak=${peak}`,
  };
}

test('20 MiB uploads and downloads round trip in bounded memory', async (t) => {
  const total = 20 * MiB;
  let mem: Awaited<ReturnType<typeof sampler>>;
  const rig = await startRig({
    async execute(e: any, ctx?: StreamContext) {
      if (e.operation.kind === 'sink') {
        const h = createHash('sha256');
        let bytes = 0;
        for await (const c of ctx!.upload!) {
          h.update(c);
          bytes += c.length;
          mem.sample();
        }
        return { ok: true, value: { bytes, sha: h.digest('hex') } };
      }
      for await (const c of generate(total, MiB)) {
        await ctx!.download!(c);
        mem.sample();
      }
      return { ok: true, value: 'sent' };
    },
  });
  // Baselines are taken once the connection exists, so socket setup is not counted.
  await rig.client.connect();
  const want = await digestOf(generate(total, MiB));

  mem = await sampler();
  const up = await rig.client.executeWithUpload(
    env('sink'),
    generate(total, MiB, () => mem.sample()),
  );
  assert.deepEqual((up as any).value, want);
  const upGrowth = mem.growth();
  const upDetail = mem.describe();

  mem = await sampler();
  const { result, body } = await rig.client.executeWithDownload(env('source'));
  const got = createHash('sha256');
  let bytes = 0;
  for await (const c of body) {
    got.update(c);
    bytes += c.length;
    mem.sample();
  }
  assert.equal(bytes, total);
  assert.equal(got.digest('hex'), want.sha);
  assert.deepEqual(await result, { ok: true, value: 'sent' });
  const downGrowth = mem.growth();
  const downDetail = mem.describe();

  t.diagnostic(`T8GROWTH up=${upGrowth} (${upDetail}) down=${downGrowth} (${downDetail})`);
  assert.ok(upGrowth < LIMIT, `upload arrayBuffers grew ${upGrowth} bytes (${upDetail})`);
  assert.ok(downGrowth < LIMIT, `download arrayBuffers grew ${downGrowth} bytes (${downDetail})`);
  await rig.close();
});
