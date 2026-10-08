import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadCoreConfig } from '../src/config.js';
import { createCoreRuntime } from '../src/runtime.js';
import { ensureLocalTls } from '../src/tls/local-tls.js';

function worker() {
  return {
    async start() {
      return {
        async execute() {
          return { ok: false, error: { code: 'EXECUTOR_UNAVAILABLE', message: 'x' } } as any;
        },
        async health() {
          return { ready: true, pid: 1 };
        },
        async close() {},
      };
    },
    async close() {},
  };
}

interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  json: any;
}

function send(url: string, method: string, headers: Record<string, string>, body?: unknown) {
  return new Promise<Reply>((resolve, reject) => {
    const request = https.request(
      url,
      {
        method,
        rejectUnauthorized: false,
        headers: { 'content-type': 'application/json', ...headers },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json: unknown;
          try {
            json = JSON.parse(text);
          } catch {
            json = undefined;
          }
          resolve({ status: response.statusCode ?? 0, headers: response.headers, json });
        });
      },
    );
    request.once('error', reject);
    request.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

const adminPhrase = 'plain admin words';

test('a tool call is metered, reported, and a profile trims tools/list', async () => {
  const stateDir = mkdtempSync(path.join(os.tmpdir(), 'aevra-token-efficiency-'));
  const config = {
    ...loadCoreConfig({
      AEVRA_STATE_DIR: stateDir,
      AEVRA_USERNAME: 'admin',
      AEVRA_PASSWORD: adminPhrase,
    }),
    publicPort: 0,
    adminPort: 0,
    mcpPort: 0,
  };
  const runtime = await createCoreRuntime(config, {
    worker: worker(),
    ensureTls: (current) => ensureLocalTls(current.stateDir, { trust: false }),
  });
  try {
    await runtime.start();
    const origin = runtime.adminUrl;
    const login = await send(
      `${runtime.adminUrl}/api/auth/login`,
      'POST',
      { origin, 'sec-fetch-site': 'same-origin' },
      { username: 'admin', password: adminPhrase },
    );
    assert.equal(login.status, 200);
    const cookie = String(login.headers['set-cookie'] ?? '').split(';')[0]!;
    const admin = (method: string, route: string, body?: unknown) =>
      send(
        `${runtime.adminUrl}${route}`,
        method,
        { cookie, origin, 'sec-fetch-site': 'same-origin' },
        body,
      );

    const created = await admin('POST', '/api/connectors', { name: 'alpha' });
    assert.equal(created.status, 201);
    const connectorUrl = `${runtime.mcpUrl}/mcp`;
    const bearer = { authorization: `Bearer ${created.json.token}` };
    const init = await send(connectorUrl, 'POST', bearer, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18' },
    });
    assert.equal(init.status, 200);
    const sessionHeader = {
      ...bearer,
      'mcp-session-id': String(init.headers['mcp-session-id'] ?? ''),
    };
    let nextId = 2;
    const mcp = async (method: string, params?: unknown) =>
      (
        await send(connectorUrl, 'POST', sessionHeader, {
          jsonrpc: '2.0',
          id: nextId++,
          method,
          ...(params === undefined ? {} : { params }),
        })
      ).json;

    const before = await mcp('tools/list');
    assert.ok(before.result.tools.some((t: any) => t.name === 'git_status'));

    await mcp('tools/call', { name: 'aevra_status', arguments: {} });

    const report = (await admin('GET', '/api/usage/tokens?range=24h')).json;
    assert.equal(report.estimator, 'heuristic-v1');
    assert.ok(report.totals.calls >= 1);
    assert.ok(report.byTool.some((t: any) => t.tool === 'aevra_status'));

    const put = await admin('PUT', '/api/connector-profiles/connector%3Aalpha', {
      toolGroups: ['files'],
    });
    assert.equal(put.status, 200);
    assert.deepEqual(put.json.profile, { toolGroups: ['files'] });

    const after = await mcp('tools/list');
    assert.ok(!after.result.tools.some((t: any) => t.name === 'git_status'));
    assert.ok(after.result.tools.some((t: any) => t.name === 'file_read_many'));

    const blocked = await mcp('tools/call', { name: 'git_status', arguments: {} });
    assert.match(JSON.stringify(blocked), /TOOL_GROUP_DISABLED/);
  } finally {
    await runtime.close();
    rmSync(stateDir, { recursive: true, force: true });
  }
});
