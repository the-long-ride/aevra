import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';
import { AevraDatabase } from '../../../packages/store/src/database.js';
import { TokenUsageRepository } from '../../../packages/store/src/token-usage.js';
import { McpIngressServer } from '../src/mcp/server.js';
import { UsageMeter } from '../src/usage/usage-meter.js';

const identity = {
  actor: 'connector:alpha',
  subject: 'alpha-client',
  issuer: 'test',
  audience: 'aevra',
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
};

function fakeRuntime() {
  const sessions = new Map<string, any>();
  return {
    sessions: {
      create(remote: any) {
        const session = { id: `session-${sessions.size + 1}`, ...remote };
        sessions.set(session.id, session);
        return session;
      },
      getOrCreateForIdentity(remote: any) {
        const existing = [...sessions.values()].find((s) => s.actor === remote.actor);
        if (existing) return { session: existing, created: false };
        return { session: this.create(remote), created: true };
      },
      get: (id: string) => sessions.get(id),
      touch() {},
      disconnect() {},
    },
    service: {
      async call(_session: string, name: string) {
        if (name === 'boom') throw new Error('boom failed');
        if (name === 'command_run') return { exitCode: 0, stdout: '界'.repeat(13000) };
        if (name === 'big') return { text: 'x'.repeat(3000) };
        return { entries: [{ name: 'a.txt' }] };
      },
    },
  } as any;
}

type Mode = 'legacy' | 'modern';

function post(
  server: McpIngressServer,
  mode: Mode,
  sessionId: string | undefined,
  method: string,
  params: Record<string, any> = {},
  extra: Record<string, string> = {},
) {
  const meta = {
    'io.modelcontextprotocol/protocolVersion': '2026-07-28',
    'io.modelcontextprotocol/clientInfo': { name: 'usage-test', version: '1' },
    'io.modelcontextprotocol/clientCapabilities': {},
  };
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method,
    params: mode === 'modern' ? { ...params, _meta: meta } : params,
  });
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...(mode === 'modern'
      ? {
          'mcp-protocol-version': '2026-07-28',
          'mcp-method': method,
          ...(params.name ? { 'mcp-name': String(params.name) } : {}),
        }
      : sessionId
        ? { 'mcp-session-id': sessionId }
        : {}),
    ...extra,
  };
  const url = new URL(`${server.url()}/mcp`);
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; json: any }>(
    (resolve, reject) => {
      const req = http.request(
        { host: url.hostname, port: url.port, path: url.pathname, method: 'POST', headers },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => {
            const raw = Buffer.concat(chunks);
            const text = (
              res.headers['content-encoding'] === 'gzip' ? gunzipSync(raw) : raw
            ).toString('utf8');
            resolve({ status: res.statusCode ?? 0, headers: res.headers, json: JSON.parse(text) });
          });
        },
      );
      req.on('error', reject);
      req.end(body);
    },
  );
}

async function runCase(mode: Mode) {
  const db = AevraDatabase.open(':memory:');
  const repo = new TokenUsageRepository(db.raw());
  const meter = new UsageMeter(repo, { log: () => {} });
  let profile: any;
  const verifier: any = {
    async verifyRequest() {
      return identity;
    },
  };
  const server = new McpIngressServer(
    '127.0.0.1',
    0,
    verifier,
    undefined,
    () => false,
    fakeRuntime(),
    undefined,
    { usage: meter, connectorProfile: () => profile },
  );
  await server.start();
  try {
    let sid: string | undefined;
    if (mode === 'legacy') {
      const init = await post(server, 'legacy', undefined, 'initialize', {
        protocolVersion: '2025-06-18',
      });
      sid = String(init.headers['mcp-session-id']);
    }
    const rowFor = (tool: string) => {
      meter.flush();
      return repo.rows({ hour: '', day: '' }).find((row) => row.tool === tool);
    };

    // 1. a call is counted under the connector and tool
    const ok = await post(server, mode, sid, 'tools/call', {
      name: 'file_list',
      arguments: { path: '/' },
    });
    assert.equal(ok.status, 200);
    const row = rowFor('file_list')!;
    assert.equal(row.connector, 'connector:alpha');
    assert.equal(row.calls, 1);
    assert.equal(row.errors, 0);
    assert.ok(row.outputTokens > 0);
    assert.ok(row.inputTokens > 0);

    // 2. a failing tool call counts one error
    await post(server, mode, sid, 'tools/call', { name: 'boom', arguments: {} });
    assert.equal(rowFor('boom')!.errors, 1);

    // 3. large responses are gzipped for clients that accept it
    const big = await post(
      server,
      mode,
      sid,
      'tools/call',
      { name: 'big', arguments: {} },
      {
        'accept-encoding': 'gzip',
      },
    );
    assert.equal(big.headers['content-encoding'], 'gzip');
    assert.ok(big.json.result);

    const unicode = await post(server, mode, sid, 'tools/call', {
      name: 'command_run',
      arguments: { maxOutputChars: 1000 },
    });
    assert.equal(unicode.status, 200);
    assert.ok(rowFor('command_run')!.savedTokens > 11980);

    // 4. the connector profile limits tools/list
    profile = { toolGroups: ['files'] };
    const list = await post(server, mode, sid, 'tools/list');
    const names = list.json.result.tools.map((tool: any) => tool.name);
    assert.ok(names.includes('file_read_many'));
    assert.equal(
      names.some((name: string) => name.startsWith('git_')),
      false,
    );
    assert.ok(rowFor('tools/list'));
  } finally {
    await server.close();
    db.close();
  }
}

test('legacy JSON-RPC calls are metered, gzipped and filtered by the connector profile', async () => {
  await runCase('legacy');
});

test('modern runtime calls are metered, gzipped and filtered by the connector profile', async () => {
  await runCase('modern');
});
