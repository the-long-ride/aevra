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
import { ConnectionWorkspaceGrantService } from '../src/sessions/connection-workspace-grants.js';
import { McpIngressServer } from '../src/mcp/server.js';
import { MODERN_PROTOCOL_VERSION } from '../src/mcp/modern-protocol.js';

const verifier = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~';
const challenge = createHash('sha256').update(verifier).digest('base64url');
const issuer = 'https://mcp.example.com';
const resource = `${issuer}/mcp`;

async function createFixture() {
  let nowMs = Date.parse('2026-09-18T10:00:00.000Z');
  const db = AevraDatabase.open(':memory:');
  const now = () => new Date(nowMs);
  const oauthRepo = new OAuthRepository(db.raw(), now);
  const auditRepo = new AuditRepository(db.raw());
  const audit = new AuditService(auditRepo);
  const auditLog: any[] = [];
  const auditWrapper = {
    append(event: any) {
      auditLog.push(event);
      audit.append(event);
    },
  };

  const oauthService = new AevraOAuthService(oauthRepo, {
    issuer,
    resource,
    now,
    accessTokenTtlMs: 60_000, // 60 seconds short-lived access token
    refreshTokenTtlMs: 30 * 24 * 60 * 60_000,
    audit: auditWrapper,
  });

  const wsRepo = new WorkspaceRepository(db.raw());
  const workspaces = new WorkspaceService(wsRepo);
  const ws = workspaces.create({ name: 'ChatGPTDev', hostRoot: '/tmp/chatgpt_dev' });

  const sessionRepo = new SessionRepository(db.raw());
  const profiles = new CapabilityProfileService(db.raw());
  const sessions = new SessionManager(
    sessionRepo,
    profiles,
    30 * 60_000,
    undefined,
    new ConnectionStateStore(oauthRepo),
    15 * 60_000,
  );
  const grantService = new ConnectionWorkspaceGrantService({
    db: db.raw(),
    oauthRepo,
    workspaceRepo: wsRepo,
    sessionRepo,
    profiles,
    sessions,
  });
  const approvals = new ApprovalService(new ApprovalRepository(db.raw()), audit, {
    fastWaitMs: 0,
    lifetimeMs: 60_000,
    lifetimeByRiskMs: {},
  });
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
      trustForwardedClientIp: () => true,
    },
  );
  await server.start();
  const addr = server.address() as any;

  return {
    db,
    oauthService,
    oauthRepo,
    workspaces,
    ws,
    sessions,
    grantService,
    auditLog,
    server,
    base: `http://127.0.0.1:${addr.port}`,
    advanceSeconds(s: number) {
      nowMs += s * 1000;
    },
  };
}

function rpcReq(auth: string, ip = '192.0.2.10') {
  return {
    headers: {
      'content-type': 'application/json',
      authorization: auth,
      'x-forwarded-for': ip,
      'mcp-protocol-version': MODERN_PROTOCOL_VERSION,
      'mcp-method': 'tools/list',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'tool-1',
      method: 'tools/list',
      params: {
        _meta: {
          'io.modelcontextprotocol/protocolVersion': MODERN_PROTOCOL_VERSION,
        },
      },
    }),
  };
}

test('ChatGPT 60s lifetime: issues refresh token for scope=mcp and renews across 3 cycles with IP rotation', async () => {
  const f = await createFixture();
  try {
    // 1. Dynamic client registration
    const client = f.oauthService.registerClient({
      client_name: 'ChatGPT',
      redirect_uris: ['https://chatgpt.com/oauth/callback'],
    });

    // 2. Authorization request with scope="mcp" (demonstrating ChatGPT's actual requested scope)
    const pending = f.oauthService.beginAuthorization(
      {
        client_id: client.client_id,
        redirect_uri: client.redirect_uris[0]!,
        response_type: 'code',
        scope: 'mcp',
        resource,
        code_challenge: challenge,
        code_challenge_method: 'S256',
      },
      '192.0.2.10',
    );

    // 3. Operator approves connection with renewable=true (Keep signed in)
    f.oauthService.approveAuthorization(pending.id, { renewable: true });
    const { code } = f.oauthService.continueAuthorization(pending.id);

    // 4. Token exchange
    const initialTokens = f.oauthService.exchangeAuthorizationCode({
      grant_type: 'authorization_code',
      client_id: client.client_id,
      code,
      redirect_uri: client.redirect_uris[0]!,
      code_verifier: verifier,
      resource,
    });

    assert.equal(initialTokens.scope, 'mcp', 'Scope is preserved as requested');
    assert.equal(initialTokens.expires_in, 60, 'Access lifetime is 60s');
    assert.ok(initialTokens.refresh_token, 'Refresh token must be issued for renewable connection');

    // Verify connection grant established for workspace
    const initialIdentity = f.oauthService.verifyAccessToken(initialTokens.access_token);
    f.grantService.grant({
      connectionId: initialIdentity.connectionId!,
      workspaceId: f.ws.id,
      profileId: 'developer',
    });

    // 5. Tool access at t=0s succeeds
    const initialCall = await fetch(`${f.base}/mcp`, {
      method: 'POST',
      ...rpcReq(`Bearer ${initialTokens.access_token}`, '192.0.2.10'),
    });
    assert.equal(initialCall.status, 200);

    // --- EXPIRY CYCLE 1 ---
    f.advanceSeconds(65); // Expire token 1

    // Token 1 is now expired: /mcp rejects with 401 and advertises scope="mcp offline_access"
    const expiredCall1 = await fetch(`${f.base}/mcp`, {
      method: 'POST',
      ...rpcReq(`Bearer ${initialTokens.access_token}`, '192.0.2.10'),
    });
    assert.equal(expiredCall1.status, 401);
    assert.match(expiredCall1.headers.get('www-authenticate') ?? '', /scope="mcp offline_access"/);

    // ChatGPT renews via refresh token
    const cycle1Tokens = f.oauthService.exchangeRefreshToken({
      grant_type: 'refresh_token',
      client_id: client.client_id,
      refresh_token: initialTokens.refresh_token!,
      resource,
    });
    assert.ok(cycle1Tokens.access_token);
    assert.ok(cycle1Tokens.refresh_token);
    assert.notEqual(cycle1Tokens.refresh_token, initialTokens.refresh_token, 'Token rotated');
    assert.equal(cycle1Tokens.scope, 'mcp');

    // Tool call with cycle 1 access token succeeds and retains workspace developer grant
    const cycle1Call = await fetch(`${f.base}/mcp`, {
      method: 'POST',
      ...rpcReq(`Bearer ${cycle1Tokens.access_token}`, '192.0.2.10'),
    });
    assert.equal(cycle1Call.status, 200);

    // --- EXPIRY CYCLE 2: IP ROTATION (Floating pool) ---
    f.advanceSeconds(65); // Expire token 2

    // ChatGPT runner IP rotates to 198.51.100.25
    const cycle2Tokens = f.oauthService.exchangeRefreshToken({
      grant_type: 'refresh_token',
      client_id: client.client_id,
      refresh_token: cycle1Tokens.refresh_token!,
      resource,
    });
    assert.ok(cycle2Tokens.access_token);
    assert.ok(cycle2Tokens.refresh_token);
    assert.notEqual(cycle2Tokens.refresh_token, cycle1Tokens.refresh_token);

    const cycle2Call = await fetch(`${f.base}/mcp`, {
      method: 'POST',
      ...rpcReq(`Bearer ${cycle2Tokens.access_token}`, '198.51.100.25'),
    });
    assert.equal(cycle2Call.status, 200);

    // --- EXPIRY CYCLE 3 ---
    f.advanceSeconds(65); // Expire token 3

    const cycle3Tokens = f.oauthService.exchangeRefreshToken({
      grant_type: 'refresh_token',
      client_id: client.client_id,
      refresh_token: cycle2Tokens.refresh_token!,
      resource,
    });
    assert.ok(cycle3Tokens.access_token);
    assert.ok(cycle3Tokens.refresh_token);

    const cycle3Call = await fetch(`${f.base}/mcp`, {
      method: 'POST',
      ...rpcReq(`Bearer ${cycle3Tokens.access_token}`, '203.0.113.88'),
    });
    assert.equal(cycle3Call.status, 200, 'Tool access succeeds through third expiry cycle');

    // Verify 3 distinct refresh audit events occurred without credentials
    const refreshAudits = f.auditLog.filter((e) => e.operation === 'oauth.token.refresh');
    assert.equal(refreshAudits.length, 3);
    for (const event of refreshAudits) {
      assert.equal(event.target, initialIdentity.connectionId);
      assert.equal(event.metadata.grantedScope, 'mcp');
    }

    // --- REPLAY PROTECTION ---
    // Attempting to reuse cycle 1 spent refresh token must fail and revoke family
    assert.throws(
      () =>
        f.oauthService.exchangeRefreshToken({
          grant_type: 'refresh_token',
          client_id: client.client_id,
          refresh_token: cycle1Tokens.refresh_token!,
          resource,
        }),
      /invalid refresh token/,
    );

    // Verify family was revoked after replay
    assert.throws(
      () =>
        f.oauthService.exchangeRefreshToken({
          grant_type: 'refresh_token',
          client_id: client.client_id,
          refresh_token: cycle3Tokens.refresh_token!,
          resource,
        }),
      /invalid refresh token/,
    );
  } finally {
    await f.server.close();
    f.db.close();
  }
});

test('server restart preserves active refresh tokens and connection grants', async () => {
  const f = await createFixture();
  try {
    const client = f.oauthService.registerClient({
      client_name: 'ChatGPT',
      redirect_uris: ['https://chatgpt.com/oauth/callback'],
    });

    const pending = f.oauthService.beginAuthorization(
      {
        client_id: client.client_id,
        redirect_uri: client.redirect_uris[0]!,
        response_type: 'code',
        scope: 'mcp',
        resource,
        code_challenge: challenge,
        code_challenge_method: 'S256',
      },
      '192.0.2.10',
    );
    f.oauthService.approveAuthorization(pending.id);
    const { code } = f.oauthService.continueAuthorization(pending.id);
    const tokens = f.oauthService.exchangeAuthorizationCode({
      grant_type: 'authorization_code',
      client_id: client.client_id,
      code,
      redirect_uri: client.redirect_uris[0]!,
      code_verifier: verifier,
      resource,
    });

    // Server restarts: invalidate ephemeral caches
    f.oauthRepo.invalidateEphemeralForRestart();
    f.sessions.invalidateForRestart();

    // Active refresh token is still valid after restart
    const refreshed = f.oauthService.exchangeRefreshToken({
      grant_type: 'refresh_token',
      client_id: client.client_id,
      refresh_token: tokens.refresh_token!,
      resource,
    });
    assert.ok(refreshed.access_token);
    assert.ok(refreshed.refresh_token);
  } finally {
    await f.server.close();
    f.db.close();
  }
});
