import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { AuditService } from '../src/audit/audit-service.js';
import { createFileLinkRoute } from '../src/mcp/file-link-route.js';
import { McpIngressServer } from '../src/mcp/server.js';
import { TransferLinkStore } from '../src/files/transfer-links.js';
import { CapabilityProfileService } from '../src/policy/capabilities.js';
import { SessionManager } from '../src/sessions/session-manager.js';
import { AuditRepository } from '../../../packages/store/src/audit.js';
import { AevraDatabase } from '../../../packages/store/src/database.js';
import { SessionRepository } from '../../../packages/store/src/sessions.js';

const DATA = Buffer.from('the file words, long enough to span two chunks');
const SHA = `sha256:${createHash('sha256').update(DATA).digest('hex')}`;
const secretOf = (url: string) => url.slice(url.lastIndexOf('/') + 1);
interface Rig {
  url: string;
  links: TransferLinkStore;
  clock: { t: number };
  calls: any[];
  audit: any[];
  alive: Set<string>;
  mint(over?: Record<string, unknown>): { secret: string; id: string };
  get(secret: string, headers?: Record<string, string>): Promise<Response>;
}

async function withRig(run: (rig: Rig) => Promise<void>, workerResult?: () => any) {
  const clock = { t: Date.now() };
  const links = new TransferLinkStore(
    () => 'https://aevra.example',
    () => clock.t,
  );
  const calls: any[] = [];
  const audit: any[] = [];
  const alive = new Set(['conn-1']);
  const worker = {
    async executeWithDownload(input: any) {
      calls.push(input);
      if (workerResult) return workerResult();
      const body = (async function* () {
        yield DATA.subarray(0, 7);
        await new Promise((resolve) => setTimeout(resolve, 5));
        yield DATA.subarray(7);
      })();
      return {
        result: Promise.resolve({ ok: true, value: { bytes: DATA.length, sha256: SHA } }),
        body,
      };
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
    {
      fileLinks: route,
    },
  );
  await server.start();
  try {
    await run({
      url: server.url(),
      links,
      clock,
      calls,
      audit,
      alive,
      mint: (over = {}) => {
        const minted = links.mint({
          connectionId: 'conn-1',
          sessionId: 'ses-1',
          actor: 'oauth:one',
          workspaceId: 'w1',
          path: '/out/some "file".bin',
          sha256: SHA,
          bytes: DATA.length,
          mimeType: 'application/octet-stream',
          ...over,
        });
        return { secret: secretOf(minted.url), id: minted.id };
      },
      get: (secret, headers = {}) => fetch(`${server.url()}/files/${secret}`, { headers }),
    });
  } finally {
    await server.close();
  }
}

test('mint then fetch returns identical bytes with download headers', async () => {
  await withRig(async (rig) => {
    const { secret } = rig.mint();
    const response = await rig.get(secret);
    assert.equal(response.status, 200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), DATA);
    assert.equal(response.headers.get('content-length'), String(DATA.length));
    assert.equal(response.headers.get('content-type'), 'application/octet-stream');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const disposition = response.headers.get('content-disposition') ?? '';
    assert.match(disposition, /^attachment; filename="[^"\\\r\n]+"$/);
    assert.equal(rig.calls[0].operation.kind, 'files.upload.read');
    assert.equal(rig.calls[0].operation.sha256, SHA);
    assert.equal(rig.calls[0].workspaceId, 'w1');
  });
});

test('a second fetch is the same 404 as an unknown link', async () => {
  await withRig(async (rig) => {
    const { secret } = rig.mint();
    assert.equal((await rig.get(secret)).status, 200);
    const used = await rig.get(secret);
    const unknown = await rig.get('z'.repeat(43));
    assert.equal(used.status, 404);
    assert.equal(unknown.status, 404);
    assert.equal(await used.text(), await unknown.text());
  });
});

test('link single use under race: one 200 and one 404', async () => {
  await withRig(async (rig) => {
    const { secret } = rig.mint();
    const statuses = (await Promise.all([rig.get(secret), rig.get(secret)])).map((r) => r.status);
    assert.deepEqual([...statuses].sort(), [200, 404]);
    assert.equal(rig.calls.length, 1);
  });
});

test('a revoked or disconnected connection gets 404', async () => {
  await withRig(async (rig) => {
    const { secret } = rig.mint();
    rig.links.revokeByConnection('conn-1');
    assert.equal((await rig.get(secret)).status, 404);
    const next = rig.mint();
    rig.alive.delete('conn-1');
    assert.equal((await rig.get(next.secret)).status, 404);
    assert.equal(rig.calls.length, 0);
  });
});

test('an expired link gets 404', async () => {
  await withRig(async (rig) => {
    const { secret } = rig.mint();
    rig.clock.t += 5 * 60_000 + 1;
    assert.equal((await rig.get(secret)).status, 404);
  });
});

test('wrong bearer gets 404 and keeps the link; no bearer or right bearer gets 200', async () => {
  await withRig(async (rig) => {
    const { secret } = rig.mint();
    const wrong = await rig.get(secret, { authorization: 'Bearer another sample value' });
    assert.equal(wrong.status, 404);
    assert.equal(rig.calls.length, 0);
    assert.equal((await rig.get(secret)).status, 200);
    const second = rig.mint();
    const right = await rig.get(second.secret, { authorization: 'Bearer sample header value' });
    assert.equal(right.status, 200);
    const stranger = rig.mint({ connectionId: 'conn-9', actor: 'oauth:nine' });
    rig.alive.add('conn-9');
    const mismatch = await rig.get(stranger.secret, {
      authorization: 'Bearer sample header value',
    });
    assert.equal(mismatch.status, 404);
  });
});

test('non-GET and malformed paths are 404', async () => {
  await withRig(async (rig) => {
    const { secret } = rig.mint();
    const post = await fetch(`${rig.url}/files/${secret}`, { method: 'POST' });
    assert.equal(post.status, 404);
    assert.equal((await fetch(`${rig.url}/files/${secret}/extra`)).status, 404);
    assert.equal((await fetch(`${rig.url}/files/`)).status, 404);
    assert.equal((await rig.get(secret)).status, 200);
  });
});

test('a pre-stream worker failure is 404 and the link may retry', async () => {
  let failing = true;
  await withRig(
    async (rig) => {
      const { secret } = rig.mint();
      assert.equal((await rig.get(secret)).status, 404);
      failing = false;
      assert.equal((await rig.get(secret)).status, 200);
    },
    () => {
      if (!failing) {
        const body = (async function* () {
          yield DATA;
        })();
        return {
          result: Promise.resolve({ ok: true, value: { bytes: DATA.length, sha256: SHA } }),
          body,
        };
      }
      return {
        result: Promise.resolve({ ok: false, error: { code: 'FILE_CHANGED', message: 'changed' } }),
        body: (async function* () {})(),
      };
    },
  );
});

test('a mid-stream failure cuts the response and frees the link', async () => {
  await withRig(
    async (rig) => {
      const { secret } = rig.mint();
      await assert.rejects(async () => (await rig.get(secret)).arrayBuffer());
      assert.ok(rig.links.claim(secret));
    },
    () => ({
      result: Promise.reject(Object.assign(new Error('boom'), { code: 'SIZE_LIMIT' })),
      body: (async function* () {
        yield DATA.subarray(0, 5);
        throw new Error('boom');
      })(),
    }),
  );
});

test('the audit event holds the link id and never the url or secret', async () => {
  await withRig(async (rig) => {
    const { secret, id } = rig.mint();
    await (await rig.get(secret)).arrayBuffer();
    const text = JSON.stringify(rig.audit);
    assert.equal(rig.audit.length, 1);
    assert.equal(rig.audit[0].operation, 'files.link.fetch');
    assert.equal(rig.audit[0].connectionId, 'conn-1');
    assert.ok(text.includes(id));
    assert.ok(!text.includes(secret));
    assert.ok(!text.includes('/files/'));
  });
});

test('real audit rows never contain the secret either', async () => {
  const db = AevraDatabase.open(':memory:');
  try {
    const audit = new AuditService(new AuditRepository(db.raw()));
    const links = new TransferLinkStore(() => 'https://aevra.example');
    const route = createFileLinkRoute({
      links,
      worker: {
        async executeWithDownload() {
          return {
            result: Promise.resolve({ ok: true, value: { bytes: DATA.length, sha256: SHA } }),
            body: (async function* () {
              yield DATA;
            })(),
          };
        },
      },
      roots: () => [],
      alive: () => true,
      audit,
    });
    const server = new McpIngressServer(
      '127.0.0.1',
      0,
      undefined,
      undefined,
      () => false,
      undefined,
      undefined,
      {
        fileLinks: route,
      },
    );
    await server.start();
    try {
      const minted = links.mint({
        connectionId: 'conn-1',
        sessionId: 's',
        actor: 'oauth:one',
        workspaceId: 'w1',
        path: '/a.bin',
        sha256: SHA,
        bytes: DATA.length,
        mimeType: 'application/octet-stream',
      });
      const secret = secretOf(minted.url);
      await (await fetch(`${server.url()}/files/${secret}`)).arrayBuffer();
      const rows = JSON.stringify(db.raw().prepare('SELECT event_json FROM audit_events').all());
      assert.ok(rows.includes('files.link.fetch'));
      assert.ok(rows.includes(minted.id));
      assert.ok(!rows.includes(secret));
    } finally {
      await server.close();
    }
  } finally {
    db.close();
  }
});

test('session disconnect and connection revoke kill outstanding links', () => {
  const db = AevraDatabase.open(':memory:');
  try {
    const sessions = new SessionManager(
      new SessionRepository(db.raw()),
      new CapabilityProfileService(db.raw()),
    );
    const links = new TransferLinkStore(() => 'https://aevra.example');
    sessions.linkRevoker = (key) => links.revokeByConnection(key);
    const identity = {
      subject: 'sub',
      actor: 'actor@example.test',
      issuer: 'https://issuer.test',
      audience: 'aud',
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    };
    const session = sessions.create(identity);
    const input = {
      connectionId: session.id,
      sessionId: session.id,
      actor: session.actor,
      workspaceId: 'w1',
      path: '/a.bin',
      sha256: SHA,
      bytes: 1,
      mimeType: 'application/octet-stream',
    };
    const first = secretOf(links.mint(input).url);
    sessions.disconnect(session.id);
    assert.equal(links.claim(first), null);

    const second = secretOf(links.mint({ ...input, connectionId: 'conn-7' }).url);
    sessions.revokeConnection('conn-7');
    assert.equal(links.claim(second), null);

    const other = sessions.create(identity);
    const third = secretOf(links.mint({ ...input, connectionId: other.id }).url);
    sessions.revoke(other.id);
    assert.equal(links.claim(third), null);
  } finally {
    db.close();
  }
});
