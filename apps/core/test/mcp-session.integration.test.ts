import assert from 'node:assert/strict';
import test from 'node:test';
import { AevraDatabase } from '../../../packages/store/src/database.js';
import { SessionRepository } from '../../../packages/store/src/sessions.js';
import { CapabilityProfileService } from '../src/policy/capabilities.js';
import { SessionManager } from '../src/sessions/session-manager.js';
import { McpIngressServer } from '../src/mcp/server.js';

const identity = {
  subject: 'sub',
  actor: 'actor@example.test',
  issuer: 'https://issuer.test',
  audience: 'aud',
  expiresAt: new Date(Date.now() + 60000).toISOString(),
};

test('MCP initialize creates server-owned session and unknown client session is rejected', async () => {
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
  } as any;
  const server = new McpIngressServer('127.0.0.1', 0, verifier, undefined, () => false, {
    sessions,
    service,
  } as any);
  await server.start();
  const init = await fetch(`${server.url()}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18' },
    }),
  });
  assert.equal(init.status, 200);
  const sid = init.headers.get('mcp-session-id');
  assert.match(sid ?? '', /^ses_/);
  const bad = await fetch(`${server.url()}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'mcp-session-id': 'client-chosen' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
  });
  assert.equal(bad.status, 404);
  const good = await fetch(`${server.url()}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'mcp-session-id': sid! },
    body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/list' }),
  });
  assert.equal(good.status, 200);
  await server.close();
  db.close();
});
