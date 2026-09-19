import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { AevraDatabase } from '../../../packages/store/src/database.js';
import { OAuthRepository } from '../../../packages/store/src/oauth.js';
import { SessionRepository } from '../../../packages/store/src/sessions.js';
import { WorkspaceRepository } from '../../../packages/store/src/workspaces.js';
import { ApprovalRepository } from '../../../packages/store/src/approvals.js';
import { AuditRepository } from '../../../packages/store/src/audit.js';
import { AevraOAuthService } from '../src/auth/oauth.js';
import { CapabilityProfileService } from '../src/policy/capabilities.js';
import { ConnectionStateStore } from '../src/sessions/connection-state.js';
import { SessionManager } from '../src/sessions/session-manager.js';
import { WorkspaceService } from '../src/workspaces/workspace-service.js';
import { ApprovalService } from '../src/approvals/approval-service.js';
import { AuditService } from '../src/audit/audit-service.js';
import { ReadVersionCache } from '../src/operations/read-version-cache.js';
import { McpToolService } from '../../../packages/mcp-tools/src/service.js';
import { McpIngressServer } from '../src/mcp/server.js';
import { MODERN_PROTOCOL_VERSION } from '../src/mcp/modern-protocol.js';

const verifier = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~';
const challenge = createHash('sha256').update(verifier).digest('base64url');
const issuer = 'https://mcp.example.com';
const resource = `${issuer}/mcp`;

async function createServer(db: AevraDatabase, trustProxy = true) {
  const oauthRepo = new OAuthRepository(db.raw());
  const oauthService = new AevraOAuthService(oauthRepo, { issuer, resource });
  const workspaces = new WorkspaceService(new WorkspaceRepository(db.raw()));
  const ws1 = workspaces.create({ name: 'WorkspaceOne', hostRoot: '/tmp/ws1' });
  const ws2 = workspaces.create({ name: 'WorkspaceTwo', hostRoot: '/tmp/ws2' });

  const sessions = new SessionManager(
    new SessionRepository(db.raw()),
    new CapabilityProfileService(db.raw()),
    30 * 60_000,
    undefined,
    new ConnectionStateStore(oauthRepo),
    15 * 60_000,
  );
  const approvals = new ApprovalService(
    new ApprovalRepository(db.raw()),
    new AuditService(new AuditRepository(db.raw())),
    { fastWaitMs: 0, lifetimeMs: 60_000, lifetimeByRiskMs: {} },
  );
  approvals.setSessionIdentityResolver((sessionId) => sessions.connectionIdentity(sessionId));

  const tools = new McpToolService(
    sessions,
    workspaces,
    { execute: async () => ({ ok: true, value: {} }) } as any,
    new ReadVersionCache(),
    approvals,
  );

  const server = new McpIngressServer(
    '127.0.0.1',
    0,
    undefined,
    undefined,
    () => false,
    { sessions, service: tools },
    undefined,
    {
      oauth: oauthService,
      plainMcpEnabled: true,
      trustForwardedClientIp: () => trustProxy,
    },
  );
  await server.start();
  const addr = server.address() as any;
  return {
    db,
    oauthService,
    oauthRepo,
    workspaces,
    ws1,
    ws2,
    sessions,
    approvals,
    server,
    base: `http://127.0.0.1:${addr.port}`,
  };
}

function issueTokens(oauthService: AevraOAuthService, clientName = 'ChatGPT') {
  const client = oauthService.registerClient({
    client_name: clientName,
    redirect_uris: ['https://example.com/oauth/callback'],
  });
  const pending = oauthService.beginAuthorization({
    client_id: client.client_id,
    redirect_uri: client.redirect_uris[0]!,
    response_type: 'code',
    scope: 'mcp offline_access',
    resource,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  oauthService.approveAuthorization(pending.id);
  const { code } = oauthService.continueAuthorization(pending.id);
  const tokens = oauthService.exchangeAuthorizationCode({
    grant_type: 'authorization_code',
    client_id: client.client_id,
    code,
    redirect_uri: client.redirect_uris[0]!,
    code_verifier: verifier,
    resource,
  });
  return { client, tokens };
}

function modernReq(auth: string, method: string, name?: string, extraArgs: any = {}) {
  return {
    headers: {
      'content-type': 'application/json',
      authorization: auth,
      'mcp-protocol-version': MODERN_PROTOCOL_VERSION,
      'mcp-method': method,
      ...(name ? { 'mcp-name': name } : {}),
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: `${method}-1`,
      method,
      params: {
        ...(name ? { name, arguments: extraArgs } : {}),
        _meta: {
          'io.modelcontextprotocol/protocolVersion': MODERN_PROTOCOL_VERSION,
          'io.modelcontextprotocol/clientInfo': { name: 'modern-test', version: '1' },
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      },
    }),
  };
}

test('HTTP OAuth continuity: legacy and modern multi-runner transport flows', async () => {
  const db = AevraDatabase.open(':memory:');
  const f = await createServer(db);
  try {
    const { client, tokens } = issueTokens(f.oauthService);
    const authHeader = `Bearer ${tokens.access_token}`;

    // 1. Legacy initialize A from IP 1.1.1.1
    const initResA = await fetch(`${f.base}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: authHeader,
        'x-forwarded-for': '1.1.1.1',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    });
    assert.equal(initResA.status, 200);
    const sessionAId = initResA.headers.get('mcp-session-id')!;
    assert.ok(sessionAId);

    f.sessions.grantConnectionWorkspace(sessionAId, f.ws1.id, 'read-only');

    // 2. Legacy same session, changed IP (2.2.2.2) succeeds
    const callResAChangedIp = await fetch(`${f.base}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: authHeader,
        'mcp-session-id': sessionAId,
        'x-forwarded-for': '2.2.2.2',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'workspace_list', arguments: {} },
      }),
    });
    assert.equal(callResAChangedIp.status, 200);

    // 3. Missing legacy session header -> 400
    const missingSession = await fetch(`${f.base}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: authHeader },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'workspace_list', arguments: {} },
      }),
    });
    assert.equal(missingSession.status, 400);

    // 4. Foreign/expired legacy session ID -> 404
    const foreignSession = await fetch(`${f.base}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: authHeader,
        'mcp-session-id': 'ses_nonexistent',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'workspace_list', arguments: {} },
      }),
    });
    assert.equal(foreignSession.status, 404);

    // Legacy initialize B from IP 3.3.3.3 inherits connection grant
    const initResB = await fetch(`${f.base}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: authHeader,
        'x-forwarded-for': '3.3.3.3',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 5, method: 'initialize', params: {} }),
    });
    assert.equal(initResB.status, 200);
    const sessionBId = initResB.headers.get('mcp-session-id')!;
    assert.notEqual(sessionBId, sessionAId);

    const callResB = await fetch(`${f.base}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: authHeader,
        'mcp-session-id': sessionBId,
        'x-forwarded-for': '3.3.3.3',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 6,
        method: 'tools/call',
        params: { name: 'workspace_current', arguments: {} },
      }),
    });
    assert.equal(callResB.status, 200);
    const currB: any = await callResB.json();
    const dataB =
      currB.result?.structuredContent ?? JSON.parse(currB.result?.content?.[0]?.text ?? '{}');
    assert.equal(dataB.id, f.ws1.id);

    // 5. Modern request without initialize or session header succeeds
    const mod1 = modernReq(authHeader, 'tools/call', 'workspace_current');
    const modernRes = await fetch(`${f.base}/mcp`, {
      method: 'POST',
      headers: { ...mod1.headers, 'x-forwarded-for': '4.4.4.4' },
      body: mod1.body,
    });
    assert.equal(modernRes.status, 200);
    const modernJson: any = await modernRes.json();
    const modernData =
      modernJson.result?.structuredContent ??
      JSON.parse(modernJson.result?.content?.[0]?.text ?? '{}');
    assert.equal(modernData.id, f.ws1.id);

    // 6. Token refresh rotates token and retains subject
    const refreshed = f.oauthService.exchangeRefreshToken({
      grant_type: 'refresh_token',
      client_id: client.client_id,
      refresh_token: tokens.refresh_token!,
      resource,
    });
    assert.ok(refreshed.access_token);
    assert.notEqual(refreshed.access_token, tokens.access_token);

    const mod2 = modernReq(`Bearer ${refreshed.access_token}`, 'tools/call', 'workspace_current');
    const modernRefreshed = await fetch(`${f.base}/mcp`, {
      method: 'POST',
      headers: mod2.headers,
      body: mod2.body,
    });
    assert.equal(modernRefreshed.status, 200);

    // 7. Refresh token reuse triggers revocation
    assert.throws(() =>
      f.oauthService.exchangeRefreshToken({
        grant_type: 'refresh_token',
        client_id: client.client_id,
        refresh_token: tokens.refresh_token!,
        resource,
      }),
    );
    const mod3 = modernReq(`Bearer ${refreshed.access_token}`, 'tools/call', 'workspace_list');
    const rejectedAfterRevoke = await fetch(`${f.base}/mcp`, {
      method: 'POST',
      headers: mod3.headers,
      body: mod3.body,
    });
    assert.equal(rejectedAfterRevoke.status, 401);
  } finally {
    await f.server.close();
    f.db.close();
  }
});

test('HTTP OAuth continuity: multiple workspaces and temporary admission isolation', async () => {
  const db = AevraDatabase.open(':memory:');
  const f = await createServer(db);
  try {
    const { tokens } = issueTokens(f.oauthService, 'MultiWsClient');
    const authHeader = `Bearer ${tokens.access_token}`;

    const initA = await fetch(`${f.base}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: authHeader },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    });
    const sA = initA.headers.get('mcp-session-id')!;

    // Grant BOTH ws1 and ws2 to connection
    f.sessions.grantConnectionWorkspace(sA, f.ws1.id, 'read-only');
    f.sessions.grantConnectionWorkspace(sA, f.ws2.id, 'read-only');

    // Modern request ambiguous tool (without workspace target) returns status multiple
    const mod = modernReq(authHeader, 'tools/call', 'workspace_current');
    const ambig = await fetch(`${f.base}/mcp`, {
      method: 'POST',
      headers: mod.headers,
      body: mod.body,
    });
    assert.equal(ambig.status, 200);
    const ambigJson: any = await ambig.json();
    const ambigData =
      ambigJson.result?.structuredContent ??
      JSON.parse(ambigJson.result?.content?.[0]?.text ?? '{}');
    assert.equal(ambigData.status, 'multiple');
    assert.equal(ambigData.workspaces?.length, 2);
  } finally {
    await f.server.close();
    f.db.close();
  }
});
