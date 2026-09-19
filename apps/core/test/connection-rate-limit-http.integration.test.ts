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
import { ConnectionRateLimiter } from '../src/mcp/connection-rate-limit.js';
import { IpRateLimiter } from '../src/mcp/rate-limit.js';

const verifier = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~';
const challenge = createHash('sha256').update(verifier).digest('base64url');
const issuer = 'https://mcp.example.com';
const resource = `${issuer}/mcp`;

async function createServer(
  db: AevraDatabase,
  connLimiter: ConnectionRateLimiter,
  invalidLimiter: IpRateLimiter,
) {
  const oauthRepo = new OAuthRepository(db.raw());
  const oauthService = new AevraOAuthService(oauthRepo, { issuer, resource });
  const workspaces = new WorkspaceService(new WorkspaceRepository(db.raw()));
  const ws1 = workspaces.create({ name: 'WorkspaceOne', hostRoot: '/tmp/ws1' });

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
      trustForwardedClientIp: () => true,
      connectionLimiter: connLimiter,
      invalidBearerLimiter: invalidLimiter,
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
    sessions,
    server,
    base: `http://127.0.0.1:${addr.port}`,
  };
}

function issueTokens(oauthService: AevraOAuthService, clientName: string) {
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

test('F5: HTTP ingress connection rate limiting, IP rotation resilience, and credential separation', async () => {
  const db = AevraDatabase.open(':memory:');
  const connLimiter = new ConnectionRateLimiter({ capacity: 2, refillPerSecond: 0 });
  const invalidLimiter = new IpRateLimiter(2, 0);

  const f = await createServer(db, connLimiter, invalidLimiter);
  try {
    const connA = issueTokens(f.oauthService, 'ChatGPT-A');
    const connB = issueTokens(f.oauthService, 'ChatGPT-B');
    const authA = `Bearer ${connA.tokens.access_token}`;
    const authB = `Bearer ${connB.tokens.access_token}`;

    const sendInit = (auth: string, ip: string) =>
      fetch(`${f.base}/mcp`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: auth,
          'x-forwarded-for': ip,
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
      });

    // 1. Repeated requests by Connection A reach 429
    const r1 = await sendInit(authA, '1.1.1.1');
    assert.equal(r1.status, 200);

    const r2 = await sendInit(authA, '1.1.1.1');
    assert.equal(r2.status, 200);

    // 3rd request exhausts capacity (capacity = 2) -> 429
    const r3 = await sendInit(authA, '1.1.1.1');
    assert.equal(r3.status, 429);
    assert.ok(r3.headers.get('retry-after'));

    // 2. IP rotation (1.1.1.1 -> 2.2.2.2) does NOT reset Connection A's bucket
    const r4 = await sendInit(authA, '2.2.2.2');
    assert.equal(r4.status, 429);

    // 3. Another valid connection (B) on the same IP (2.2.2.2) remains usable
    const rB1 = await sendInit(authB, '2.2.2.2');
    assert.equal(rB1.status, 200);

    // 4. Invalid bearer token requests exhaust invalidBearerLimiter
    const badAuth = 'Bearer totally_invalid_token_xyz';
    const bad1 = await sendInit(badAuth, '3.3.3.3');
    assert.equal(bad1.status, 401);

    const bad2 = await sendInit(badAuth, '3.3.3.3');
    assert.equal(bad2.status, 401);

    const bad3 = await sendInit(badAuth, '3.3.3.3');
    assert.equal(bad3.status, 429);

    // Valid Connection B from the same IP 3.3.3.3 is NOT blocked by invalid bearer exhaustion!
    const rB2 = await sendInit(authB, '3.3.3.3');
    assert.equal(rB2.status, 200);

    // 5. Revocation / clear on Connection A resets limit
    // Find connection ID for Conn A
    const activeConns = f.oauthRepo.listConnections();
    const targetConn = activeConns.find((c) => c.actor.includes('ChatGPT-A'));
    assert.ok(targetConn);

    connLimiter.clear(targetConn.subject);
    const r5 = await sendInit(authA, '4.4.4.4');
    assert.equal(r5.status, 200);
  } finally {
    await f.server.close();
    f.db.close();
  }
});
