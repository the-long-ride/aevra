import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { McpIngressServer } from '../src/mcp/server.js';
import { modernDiscoverResult } from '../src/mcp/modern-protocol.js';
import { aevraServerInfo } from '../src/mcp/server-info.js';

const NOTICE =
  'This connector has 1 note(s) the user wants read on connect. Call notes_list, then notes_read for each note with readOnConnect true, before starting other work.';
const identity = {
  actor: 'connector:alpha',
  subject: 'alpha-client',
  issuer: 'test',
  audience: 'aevra',
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
};

function runtime() {
  const sessions = new Map<string, any>();
  return {
    sessions: {
      create(remote: any) {
        const session = { id: `session-${sessions.size + 1}`, ...remote };
        sessions.set(session.id, session);
        return session;
      },
      get: (id: string) => sessions.get(id),
      touch() {},
      disconnect() {},
    },
    service: { call: async () => ({}) },
  } as any;
}

function post(server: McpIngressServer, method: string, modern: boolean) {
  const params = modern
    ? { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } }
    : { protocolVersion: '2025-06-18' };
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...(modern ? { 'mcp-protocol-version': '2026-07-28', 'mcp-method': method } : {}),
  };
  const url = new URL(`${server.url()}/mcp`);
  return new Promise<any>((resolve, reject) => {
    const req = http.request(
      { host: url.hostname, port: url.port, path: url.pathname, method: 'POST', headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))));
      },
    );
    req.on('error', reject);
    req.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }));
  });
}

async function withServer(
  notice: string | null,
  work: (server: McpIngressServer) => Promise<void>,
) {
  const asked: string[] = [];
  const server = new McpIngressServer(
    '127.0.0.1',
    0,
    { verifyRequest: async () => identity } as any,
    undefined,
    () => false,
    runtime(),
    undefined,
    {
      connectNotice: (actor: string) => {
        asked.push(actor);
        return notice;
      },
    },
  );
  await server.start();
  try {
    await work(server);
  } finally {
    await server.close();
  }
  assert.ok(asked.length > 0);
  assert.ok(asked.every((actor) => actor === 'connector:alpha'));
}

test('legacy initialize carries the notes notice only when there is one', async () => {
  await withServer(NOTICE, async (server) => {
    const init = await post(server, 'initialize', false);
    assert.equal(init.result.instructions, NOTICE);
  });
  await withServer(null, async (server) => {
    const init = await post(server, 'initialize', false);
    assert.equal('instructions' in init.result, false);
  });
});

test('modern discover appends the notice, and discover is private either way', async () => {
  await withServer(NOTICE, async (server) => {
    const found = await post(server, 'server/discover', true);
    assert.equal(found.result.cacheScope, 'private');
    assert.ok(found.result.instructions.endsWith(NOTICE));
    assert.ok(found.result.instructions.startsWith(aevraServerInfo().description));
  });
  await withServer(null, async (server) => {
    const found = await post(server, 'server/discover', true);
    assert.equal(found.result.cacheScope, 'private');
    assert.equal(found.result.instructions.includes('notes_list'), false);
  });
});

test('modernDiscoverResult without a notice is unchanged', () => {
  assert.deepEqual(
    modernDiscoverResult('https://example.test', null),
    modernDiscoverResult('https://example.test'),
  );
  assert.equal(modernDiscoverResult(undefined, NOTICE).cacheScope, 'private');
});
