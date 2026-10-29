import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createFileLinkRoute } from '../src/mcp/file-link-route.js';
import { McpIngressServer } from '../src/mcp/server.js';
import { TransferLinkStore } from '../src/files/transfer-links.js';

const DATA = Buffer.from('the file words, long enough to span two chunks');
const SHA = `sha256:${createHash('sha256').update(DATA).digest('hex')}`;
const secretOf = (url: string) => url.slice(url.lastIndexOf('/') + 1);
const TTL = 5 * 60_000;

interface Rig {
  links: TransferLinkStore;
  clock: { t: number };
  calls: any[];
  audit: any[];
  alive: Set<string>;
  mint(): { secret: string; id: string };
  get(secret: string, headers?: Record<string, string>): Promise<Response>;
}

const goodResult = () => Promise.resolve({ ok: true, value: { bytes: DATA.length, sha256: SHA } });

async function withRig(run: (rig: Rig) => Promise<void>, body?: (rig: Rig) => any) {
  const clock = { t: Date.now() };
  const links = new TransferLinkStore(
    () => 'https://aevra.example',
    () => clock.t,
  );
  const calls: any[] = [];
  const audit: any[] = [];
  const alive = new Set(['conn-1']);
  let rig!: Rig;
  const worker = {
    async executeWithDownload(input: any) {
      calls.push(input);
      if (body) return body(rig);
      const stream = (async function* () {
        yield DATA;
      })();
      return { result: goodResult(), body: stream };
    },
  };
  const route = createFileLinkRoute({
    links,
    worker,
    roots: () => [],
    alive: (id) => alive.has(id),
    identify: async (token) =>
      token === 'sample header value' ? { connectionId: 'conn-1', actor: 'oauth:one' } : null,
    audit: { append: (event: any) => audit.push(event) } as any,
  });
  const server = new McpIngressServer(
    '127.0.0.1',
    0,
    undefined,
    undefined,
    () => false,
    undefined,
    undefined,
    { fileLinks: route },
  );
  await server.start();
  rig = {
    links,
    clock,
    calls,
    audit,
    alive,
    mint: () => {
      const minted = links.mint({
        connectionId: 'conn-1',
        sessionId: 'ses-1',
        actor: 'oauth:one',
        workspaceId: 'w1',
        path: '/out/file.bin',
        sha256: SHA,
        bytes: DATA.length,
        mimeType: 'application/octet-stream',
      });
      return { secret: secretOf(minted.url), id: minted.id };
    },
    get: (secret, headers = {}) => fetch(`${server.url()}/files/${secret}`, { headers }),
  };
  try {
    await run(rig);
  } finally {
    await server.close();
  }
}

test('a slow body whose clock passes the ttl mid-stream still delivers every byte', async () => {
  await withRig(
    async (rig) => {
      const { secret, id } = rig.mint();
      const response = await rig.get(secret);
      assert.equal(response.status, 200);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), DATA);
      assert.equal(rig.audit.length, 1);
      assert.equal(rig.audit[0].result, `ok link ${id}`);
    },
    (rig) => ({
      result: goodResult(),
      body: (async function* () {
        yield DATA.subarray(0, 7);
        rig.clock.t += TTL + 60_000;
        await new Promise((resolve) => setTimeout(resolve, 5));
        yield DATA.subarray(7);
      })(),
    }),
  );
});

test('a revoked link mid-stream is audited as failed with the link id', async () => {
  await withRig(
    async (rig) => {
      const { secret, id } = rig.mint();
      await rig
        .get(secret)
        .then((r) => r.arrayBuffer())
        .catch(() => undefined);
      assert.equal(rig.audit.length, 1);
      assert.equal(rig.audit[0].operation, 'files.link.fetch');
      assert.equal(rig.audit[0].result, `failed link ${id} revoked`);
      assert.ok(!JSON.stringify(rig.audit).includes(secret));
    },
    (rig) => ({
      result: goodResult(),
      body: (async function* () {
        yield DATA.subarray(0, 7);
        rig.links.revokeByConnection('conn-1');
        yield DATA.subarray(7);
      })(),
    }),
  );
});

test('a worker that fails is audited as failed', async () => {
  await withRig(
    async (rig) => {
      const { secret, id } = rig.mint();
      assert.equal((await rig.get(secret)).status, 404);
      assert.equal(rig.audit.length, 1);
      assert.equal(rig.audit[0].result, `failed link ${id} worker failed`);
    },
    () => ({
      result: Promise.resolve({ ok: false, error: { code: 'NOT_FOUND', message: 'gone' } }),
      body: (async function* () {})(),
    }),
  );
});

test('a bearer mismatch and a dead connection are audited; unknown links are not', async () => {
  await withRig(async (rig) => {
    const wrong = rig.mint();
    const response = await rig.get(wrong.secret, { authorization: 'Bearer another sample value' });
    assert.equal(response.status, 404);
    assert.equal(rig.audit.length, 1);
    assert.equal(rig.audit[0].result, `failed link ${wrong.id} bearer mismatch`);
    const dead = rig.mint();
    rig.alive.delete('conn-1');
    assert.equal((await rig.get(dead.secret)).status, 404);
    assert.equal(rig.audit.length, 2);
    assert.equal(rig.audit[1].result, `failed link ${dead.id} connection closed`);
    assert.equal((await rig.get('z'.repeat(43))).status, 404);
    assert.equal(rig.audit.length, 2);
  });
});

test('the worker operation carries a finite timeoutMs of at least 5 minutes', async () => {
  await withRig(async (rig) => {
    const { secret } = rig.mint();
    await (await rig.get(secret)).arrayBuffer();
    const op = rig.calls[0].operation;
    assert.ok(Number.isFinite(op.timeoutMs));
    assert.ok(op.timeoutMs >= 300_000);
  });
});
