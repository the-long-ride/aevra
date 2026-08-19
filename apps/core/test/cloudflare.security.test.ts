import assert from 'node:assert/strict';
import test from 'node:test';
import { McpIngressServer } from '../src/mcp/server.js';
import { CloudflareAccessVerifier } from '../src/auth/cloudflare.js';
import { createTestIssuer } from './support/test-issuer.js';
test('spoofed Cloudflare identity header without JWT is 401', async () => {
  const i = createTestIssuer();
  const s = new McpIngressServer(
    '127.0.0.1',
    0,
    new CloudflareAccessVerifier(i.issuer, i.audience, i.provider),
  );
  await s.start();
  const r = await fetch(`${s.url()}/mcp`, {
    headers: { 'cf-access-authenticated-user-email': 'mallory@example.com' },
  });
  assert.equal(r.status, 401);
  await s.close();
});
