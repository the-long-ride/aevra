import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import http from 'node:http';
import test from 'node:test';
import { createFileLinkRoute } from '../src/mcp/file-link-route.js';
import { McpIngressServer } from '../src/mcp/server.js';
import { TransferLinkStore } from '../src/files/transfer-links.js';

const DATA = Buffer.from('the file words, long enough to span two chunks');
const SHA = `sha256:${createHash('sha256').update(DATA).digest('hex')}`;
const secretOf = (url: string) => url.slice(url.lastIndexOf('/') + 1);
const MIB = 1024 * 1024;

interface Ctx {
  links: TransferLinkStore;
  audit: any[];
  ips: string[];
  url: string;
  mint(bytes: number): { secret: string; id: string };
}

async function withRoute(
  worker: any,
  run: (ctx: Ctx) => Promise<void>,
  extra: Record<string, unknown> = {},
  serverOptions: Record<string, unknown> = {},
) {
  const links = new TransferLinkStore(() => 'https://aevra.example');
  const audit: any[] = [];
  const ips: string[] = [];
  const route = createFileLinkRoute({
    links,
    worker,
    roots: () => [],
    alive: () => true,
    identify: async (token, ip) => {
      ips.push(ip);
      return token === 'sample header value' ? { connectionId: 'conn-1' } : null;
    },
    audit: { append: (event: any) => audit.push(event) } as any,
    ...extra,
  });
  const server = new McpIngressServer(
    '127.0.0.1',
    0,
    undefined,
    undefined,
    () => false,
    undefined,
    undefined,
    { fileLinks: route, ...serverOptions },
  );
  await server.start();
  const mint = (bytes: number) => {
    const minted = links.mint({
      connectionId: 'conn-1',
      sessionId: 'ses-1',
      actor: 'oauth:one',
      workspaceId: 'w1',
      path: '/out/file.bin',
      sha256: SHA,
      bytes,
      mimeType: 'application/octet-stream',
    });
    return { secret: secretOf(minted.url), id: minted.id };
  };
  try {
    await run({ links, audit, ips, url: server.url(), mint });
  } finally {
    await server.close();
  }
}

const changedLater = () =>
  new Promise((resolve) =>
    setTimeout(() => resolve({ ok: false, error: { code: 'FILE_CHANGED', message: 'x' } }), 60),
  );

test('a client that stops reading is cut off by the drain timeout and the link is released', async () => {
  const total = 64 * MIB;
  const worker = {
    async executeWithDownload() {
      const body = (async function* () {
        for (let sent = 0; sent < total; sent += MIB) yield Buffer.alloc(MIB, 1);
      })();
      return { result: Promise.resolve({ ok: true, value: {} }), body };
    },
  };
  await withRoute(
    worker,
    async (ctx) => {
      const { secret, id } = ctx.mint(total);
      const req = http.get(`${ctx.url}/files/${secret}`, (res) => res.pause());
      req.on('error', () => undefined);
      const started = Date.now();
      while (ctx.audit.length === 0 && Date.now() - started < 5000) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      req.destroy();
      assert.equal(ctx.audit.length, 1);
      assert.equal(ctx.audit[0].result, `failed link ${id} client stalled`);
      assert.equal(ctx.links.claim(secret)?.id, id);
    },
    { drainTimeoutMs: 150 },
  );
});

test('a changed file reported after the last byte never gives the client a full body', async () => {
  const worker = {
    async executeWithDownload() {
      const body = (async function* () {
        yield DATA.subarray(0, 7);
        yield DATA.subarray(7);
      })();
      return { result: changedLater(), body };
    },
  };
  await withRoute(worker, async (ctx) => {
    const { secret, id } = ctx.mint(DATA.length);
    const received = await new Promise<number>((resolve) => {
      let size = 0;
      const req = http.get(`${ctx.url}/files/${secret}`, (res) => {
        res.on('data', (chunk) => (size += chunk.length));
        res.on('close', () => resolve(size));
        res.on('error', () => undefined);
      });
      req.on('error', () => resolve(size));
    });
    assert.ok(received < DATA.length, `received ${received} of ${DATA.length}`);
    assert.equal(ctx.audit[0].result, `failed link ${id} worker failed`);
  });
});

test('a forwarded client ip reaches identify only when the server trusts it', async () => {
  for (const trust of [true, false]) {
    await withRoute(
      {},
      async (ctx) => {
        const { secret } = ctx.mint(1);
        await fetch(`${ctx.url}/files/${secret}`, {
          headers: {
            authorization: 'Bearer sample header value',
            'cf-connecting-ip': '203.0.113.9',
          },
        });
        assert.equal(ctx.ips[0], trust ? '203.0.113.9' : '127.0.0.1');
      },
      {},
      { trustForwardedClientIp: () => trust },
    );
  }
});
