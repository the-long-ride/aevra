import assert from 'node:assert/strict';
import test from 'node:test';
import { AevraDatabase } from '../../../packages/store/src/database.js';
import { SessionRepository } from '../../../packages/store/src/sessions.js';
import { CapabilityProfileService } from '../src/policy/capabilities.js';
import { SessionManager } from '../src/sessions/session-manager.js';
import { McpIngressServer } from '../src/mcp/server.js';
import { readMcpBody } from '../src/mcp/body-cap.js';

const MiB = 1024 * 1024;
const identity = {
  subject: 'sub',
  actor: 'actor@example.test',
  issuer: 'https://issuer.test',
  audience: 'aud',
  expiresAt: new Date(Date.now() + 60000).toISOString(),
};

async function withServer(
  run: (
    post: (body: unknown, session?: string) => Promise<Response>,
    session: string,
  ) => Promise<void>,
) {
  const db = AevraDatabase.open(':memory:');
  const sessions = new SessionManager(
    new SessionRepository(db.raw()),
    new CapabilityProfileService(db.raw()),
  );
  const verifier = {
    async verifyRequest() {
      return identity;
    },
  } as any;
  const service = {
    async call() {
      return { ok: true };
    },
    transferInlineLimitBytes: () => MiB,
  } as any;
  const server = new McpIngressServer('127.0.0.1', 0, verifier, undefined, () => false, {
    sessions,
    service,
  } as any);
  await server.start();
  try {
    const post = (body: unknown, session?: string) =>
      fetch(`${server.url()}/mcp`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(session ? { 'mcp-session-id': session } : {}),
        },
        body: JSON.stringify(body),
      });
    const init = await post({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18' },
    });
    const session = init.headers.get('mcp-session-id')!;
    await run(post, session);
  } finally {
    await server.close();
    db.close();
  }
}

const toolCall = (name: string, pad: number) => ({
  jsonrpc: '2.0',
  id: 7,
  method: 'tools/call',
  params: { name, arguments: { pad: 'x'.repeat(pad) } },
});

test('a 2 MiB file_read_many POST is rejected with 413', async () => {
  await withServer(async (post, session) => {
    const response = await post(toolCall('file_read_many', 2 * MiB), session);
    assert.equal(response.status, 413);
    assert.match(JSON.stringify(await response.json()), /MCP request too large/);
  });
});

test('a 2 MiB files_download POST is accepted', async () => {
  await withServer(async (post, session) => {
    const response = await post(toolCall('files_download', 2 * MiB), session);
    assert.equal(response.status, 200);
  });
});

test('even files_download stops at the inline limit plus overhead', async () => {
  await withServer(async (post, session) => {
    const response = await post(toolCall('files_download', 3 * MiB), session);
    assert.equal(response.status, 413);
  });
});

test('requests up to 1 MiB are unaffected for every tool', async () => {
  await withServer(async (post, session) => {
    const response = await post(toolCall('file_read_many', 512 * 1024), session);
    assert.equal(response.status, 200);
  });
});

test('a declared content-length above the ceiling is refused before any byte is read', async () => {
  const req: any = {
    headers: { 'content-length': String(40 * MiB) },
    [Symbol.asyncIterator]() {
      throw new Error('the body must not be read');
    },
  };
  await assert.rejects(readMcpBody(req, MiB), (error: any) => error.status === 413);
});
