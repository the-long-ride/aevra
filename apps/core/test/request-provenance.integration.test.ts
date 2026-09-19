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
import {
  currentRequestProvenance,
  extractRequestProvenance,
  withRequestProvenance,
} from '../src/mcp/request-provenance.js';

const verifier = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~';
const challenge = createHash('sha256').update(verifier).digest('base64url');
const issuer = 'https://mcp.example.com';
const resource = `${issuer}/mcp`;

test('Request provenance context propagation via AsyncLocalStorage', async () => {
  const prov = {
    requestId: 'req_123',
    remoteIp: '10.0.0.1',
    userAgent: 'AgentSmith/1.0',
    connectionId: 'conn_abc',
    connectionSubject: 'conn_abc',
    actor: 'user1',
  };

  assert.equal(currentRequestProvenance(), undefined);
  await withRequestProvenance(prov, async () => {
    assert.deepEqual(currentRequestProvenance(), prov);
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(currentRequestProvenance(), prov);
  });
  assert.equal(currentRequestProvenance(), undefined);
});

test('AuditService enriches events with request provenance when fields are omitted', () => {
  const db = AevraDatabase.open(':memory:');
  const auditRepo = new AuditRepository(db.raw());
  const auditService = new AuditService(auditRepo);

  const prov = {
    requestId: 'req_audit_test',
    remoteIp: '192.168.1.50',
    connectionId: 'conn_provenance_test',
    actor: 'oauth_actor',
  };

  withRequestProvenance(prov, () => {
    const event = auditService.append({
      operation: 'workspace.read',
      result: 'success',
      redactionCount: 0,
    });
    assert.equal(event.remoteIp, '192.168.1.50');
    assert.equal((event as any).connectionId, 'conn_provenance_test');
    assert.equal(event.actor, 'oauth_actor');
  });

  // Explicit values take precedence over ambient provenance
  withRequestProvenance(prov, () => {
    const event = auditService.append({
      operation: 'workspace.write',
      remoteIp: '1.1.1.1',
      connectionId: 'explicit_conn',
      actor: 'explicit_actor',
      result: 'success',
      redactionCount: 0,
    });
    assert.equal(event.remoteIp, '1.1.1.1');
    assert.equal((event as any).connectionId, 'explicit_conn');
    assert.equal(event.actor, 'explicit_actor');
  });
});

test('Bounded connection origins: records and prunes recent origins up to cap', async () => {
  const db = AevraDatabase.open(':memory:');
  const oauthRepo = new OAuthRepository(db.raw());
  const oauthService = new AevraOAuthService(oauthRepo, { issuer, resource });

  const client = oauthService.registerClient({
    client_name: 'ProvClient',
    redirect_uris: ['https://client.example.com/cb'],
  });
  const authReq = oauthService.beginAuthorization({
    client_id: client.client_id,
    redirect_uri: client.redirect_uris[0],
    response_type: 'code',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    scope: 'mcp',
    resource,
  });
  oauthService.approveAuthorization(authReq.id);
  const { code } = oauthService.continueAuthorization(authReq.id);
  const tokens = oauthService.exchangeAuthorizationCode({
    grant_type: 'authorization_code',
    client_id: client.client_id,
    code,
    redirect_uri: client.redirect_uris[0],
    code_verifier: verifier,
    resource,
  });

  const identity = oauthService.verifyAccessToken(tokens.access_token);
  const subject = identity.subject;

  // Record origins from 15 different IPs with sequential timestamps
  const baseTime = Date.now();
  for (let i = 1; i <= 15; i++) {
    const ip = `192.168.10.${i}`;
    const time = new Date(baseTime + i * 1000).toISOString();
    oauthRepo.recordConnectionOrigin(subject, ip, time);
  }

  const origins = oauthService.listConnectionOrigins(subject);
  // Cap is 10 bounded origins
  assert.equal(origins.length, 10);
  // Most recent should be 192.168.10.15
  assert.equal(origins[0].remoteIp, '192.168.10.15');
  // Oldest remaining should be 192.168.10.6
  assert.equal(origins[9].remoteIp, '192.168.10.6');

  // Updating an existing IP refreshes its lastSeenAt without duplicating
  const refreshTime = new Date(baseTime + 20_000).toISOString();
  oauthRepo.recordConnectionOrigin(subject, '192.168.10.6', refreshTime);
  const updatedOrigins = oauthService.listConnectionOrigins(subject);
  assert.equal(updatedOrigins.length, 10);
  assert.equal(updatedOrigins[0].remoteIp, '192.168.10.6');
});
