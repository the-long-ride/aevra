import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable } from 'node:stream';
import { ConnectionAdminService } from '../src/admin/connection-admin.js';
import { handleConnectionRoutes } from '../src/admin/routes/connection-routes.js';
import { AevraDatabase } from '../../../packages/store/src/database.js';
import { OAuthRepository } from '../../../packages/store/src/oauth.js';
import { SessionRepository } from '../../../packages/store/src/sessions.js';
import { WorkspaceRepository } from '../../../packages/store/src/workspaces.js';
import { CapabilityProfileService } from '../src/policy/capabilities.js';
import { ConnectionWorkspaceGrantService } from '../src/sessions/connection-workspace-grants.js';
import { SessionManager } from '../src/sessions/session-manager.js';
import { WorkspaceService } from '../src/workspaces/workspace-service.js';

function request(method: string, body?: any) {
  const content = body ? [Buffer.from(JSON.stringify(body))] : [];
  const stream = Readable.from(content) as any;
  stream.method = method;
  stream.headers = body ? { 'content-type': 'application/json' } : {};
  return stream;
}

function response() {
  const result = {
    statusCode: 0,
    body: '',
    setHeader() {},
    end(value = '') {
      result.body = String(value);
    },
  };
  return result as any;
}

async function call(pathname: string, method: string, context: any, body?: any) {
  const res = response();
  const handled = await handleConnectionRoutes(
    request(method, body),
    res,
    new URL(`https://localhost${pathname}`),
    context,
  );
  return {
    handled,
    status: res.statusCode,
    value: res.body ? JSON.parse(res.body) : undefined,
  };
}

test('ConnectionAdminService integrates durable workspace grants and origins', () => {
  const oauth = {
    listConnections: () => [
      {
        subject: 'conn_chatgpt',
        actor: 'oauth:ChatGPT',
        status: 'ACTIVE',
        yoloEnabled: false,
        lastUsedAt: '2026-09-17T12:00:00.000Z',
      },
    ],
    getLatestRefreshFamily: () => null,
    listConnectionOrigins: (subj: string) =>
      subj === 'conn_chatgpt'
        ? [{ remoteIp: '1.2.3.4', lastSeenAt: '2026-09-17T12:00:00.000Z' }]
        : [],
  } as any;

  const sessions = {
    list: () => [],
  };

  const grantHandler = {
    grants: [{ connectionId: 'conn_chatgpt', workspaceId: 'ws_durable', profileId: 'read-only' }],
    grant: (input: any) => {
      grantHandler.grants.push(input);
      return { ok: true };
    },
    remove: (connId: string, wsId: string) => {
      const idx = grantHandler.grants.findIndex(
        (g) => g.connectionId === connId && g.workspaceId === wsId,
      );
      if (idx >= 0) {
        grantHandler.grants.splice(idx, 1);
        return { removed: true };
      }
      return { removed: false };
    },
    list: (connId: string) => grantHandler.grants.filter((g) => g.connectionId === connId),
  };

  const service = new ConnectionAdminService(oauth, sessions, 3600, () => new Date(), grantHandler);
  const [row] = service.list();

  // Projection includes durable workspace and origins even while offline
  assert.equal(row.connectionId, 'conn_chatgpt');
  assert.equal(row.status, 'OFFLINE');
  assert.deepEqual(row.workspaceIds, ['ws_durable']);
  assert.equal(row.recentOrigins?.length, 1);
  assert.equal(row.recentOrigins?.[0]?.remoteIp, '1.2.3.4');
  assert.equal(row.workspaceGrants?.length, 1);

  // Grant another workspace
  service.grantWorkspace('conn_chatgpt', 'ws_second', 'read-write');
  const [updatedRow] = service.list();
  assert.deepEqual(updatedRow.workspaceIds, ['ws_durable', 'ws_second']);

  // Revoke first workspace
  const revoked = service.revokeWorkspace('conn_chatgpt', 'ws_durable');
  assert.equal(revoked, true);
  const [finalRow] = service.list();
  assert.deepEqual(finalRow.workspaceIds, ['ws_second']);
});

test('handleConnectionRoutes grants and revokes connection-level workspaces with audit', async () => {
  const auditEvents: any[] = [];
  const grants: Record<string, string[]> = {
    conn_1: ['ws_a'],
  };

  const connections = {
    list: () => [{ id: 'conn_1', connectionId: 'conn_1', workspaceIds: grants['conn_1'] }],
    grantWorkspace: (connId: string, wsId: string) => {
      if (!grants[connId]) grants[connId] = [];
      grants[connId].push(wsId);
      return true;
    },
    revokeWorkspace: (connId: string, wsId: string) => {
      const list = grants[connId];
      if (!list || !list.includes(wsId)) return false;
      grants[connId] = list.filter((id) => id !== wsId);
      return true;
    },
  };

  const context = {
    connections,
    audit: {
      append: (e: any) => auditEvents.push(e),
    },
  };

  // 1. Grant workspace
  const grantRes = await call('/api/connections/conn_1/workspaces', 'POST', context, {
    workspaceId: 'ws_b',
    profileId: 'read-write',
  });
  assert.equal(grantRes.status, 200);
  assert.deepEqual(grants['conn_1'], ['ws_a', 'ws_b']);
  assert.equal(auditEvents[0].operation, 'connection.workspace_grant');
  assert.equal(auditEvents[0].target, 'conn_1:ws_b');

  // 2. Grant workspace without workspaceId fails
  const badGrant = await call('/api/connections/conn_1/workspaces', 'POST', context, {});
  assert.equal(badGrant.status, 400);

  // 3. Revoke workspace
  const revokeRes = await call('/api/connections/conn_1/workspaces/ws_a', 'DELETE', context);
  assert.equal(revokeRes.status, 200);
  assert.deepEqual(grants['conn_1'], ['ws_b']);
  assert.equal(auditEvents[1].operation, 'connection.workspace_revoke');
  assert.equal(auditEvents[1].target, 'conn_1:ws_a');

  // 4. Revoking non-existent grant returns 404
  const missingRevoke = await call(
    '/api/connections/conn_1/workspaces/ws_nonexistent',
    'DELETE',
    context,
  );
  assert.equal(missingRevoke.status, 404);
});

test('F2: handleConnectionRoutes with production ConnectionAdminService and ConnectionWorkspaceGrantService', async () => {
  const db = AevraDatabase.open(':memory:');
  const wsRepo = new WorkspaceRepository(db.raw());
  const workspaceService = new WorkspaceService(wsRepo);
  const ws1 = workspaceService.create({ name: 'Workspace1', hostRoot: '/tmp/ws1' });
  const oauthRepo = new OAuthRepository(db.raw());
  const sessionRepo = new SessionRepository(db.raw());
  const profiles = new CapabilityProfileService(db.raw());
  const sessions = new SessionManager(sessionRepo, profiles);
  const grantHandler = new ConnectionWorkspaceGrantService({
    db: db.raw(),
    oauthRepo,
    workspaceRepo: wsRepo,
    sessionRepo,
    profiles,
    sessions,
  });
  const service = new ConnectionAdminService(oauthRepo, sessions, 3600, undefined, grantHandler);
  const auditEvents: any[] = [];
  const context = {
    connections: service,
    audit: { append: (e: any) => auditEvents.push(e) },
  };

  // Register active connection
  const client = oauthRepo.registerClient({
    clientName: 'ChatGPT',
    redirectUris: ['https://example.com/cb'],
  });
  oauthRepo.ensureConnection({
    clientId: client.clientId,
    actor: 'oauth:ChatGPT',
    subject: 'conn_active',
    scope: 'mcp',
    resource: 'https://example.com',
  });

  // Register revoked connection
  oauthRepo.ensureConnection({
    clientId: client.clientId,
    actor: 'oauth:ChatGPT',
    subject: 'conn_revoked',
    scope: 'mcp',
    resource: 'https://example.com',
  });
  db.raw()
    .prepare("UPDATE oauth_connections SET status='REVOKED' WHERE subject='conn_revoked'")
    .run();

  // 1. Unknown profile -> 400, no grant written
  const badProfile = await call('/api/connections/conn_active/workspaces', 'POST', context, {
    workspaceId: ws1.id,
    profileId: 'nonexistent-profile',
  });
  assert.equal(badProfile.status, 400);
  assert.equal(badProfile.value?.error?.code, 'INVALID_REQUEST');
  assert.deepEqual(sessionRepo.listRememberedWorkspaceGrants('conn_active'), []);

  // 2. Unknown workspace -> 404, no grant written
  const badWs = await call('/api/connections/conn_active/workspaces', 'POST', context, {
    workspaceId: 'ws_missing',
    profileId: 'read-only',
  });
  assert.equal(badWs.status, 404);
  assert.equal(badWs.value?.error?.code, 'NOT_FOUND');
  assert.deepEqual(sessionRepo.listRememberedWorkspaceGrants('conn_active'), []);

  // 3. Unknown connection -> 404
  const badConn = await call('/api/connections/conn_nonexistent/workspaces', 'POST', context, {
    workspaceId: ws1.id,
    profileId: 'read-only',
  });
  assert.equal(badConn.status, 404);
  assert.equal(badConn.value?.error?.code, 'NOT_FOUND');

  // 4. Revoked connection -> 409
  const revokedConn = await call('/api/connections/conn_revoked/workspaces', 'POST', context, {
    workspaceId: ws1.id,
    profileId: 'read-only',
  });
  assert.equal(revokedConn.status, 409);
  assert.equal(revokedConn.value?.error?.code, 'CONFLICT');

  // 5. Valid offline grant works without any active session
  const validOffline = await call('/api/connections/conn_active/workspaces', 'POST', context, {
    workspaceId: ws1.id,
    profileId: 'developer',
  });
  assert.equal(validOffline.status, 200);
  const grants = sessionRepo.listRememberedWorkspaceGrants('conn_active');
  assert.equal(grants.length, 1);
  assert.equal(grants[0]!.workspaceId, ws1.id);
  assert.equal(grants[0]!.profileId, 'developer');

  // Verify ConnectionAdminService.list() includes the offline grant
  const [connRow] = service.list().filter((c) => c.connectionId === 'conn_active');
  assert.equal(connRow?.status, 'OFFLINE');
  assert.deepEqual(connRow?.workspaceIds, [ws1.id]);
  assert.equal(connRow?.workspaceGrants?.[0]?.profileId, 'developer');

  // 6. Revoking grant works
  const revokeRes = await call(
    `/api/connections/conn_active/workspaces/${ws1.id}`,
    'DELETE',
    context,
  );
  assert.equal(revokeRes.status, 200);
  assert.deepEqual(sessionRepo.listRememberedWorkspaceGrants('conn_active'), []);

  // 7. Revoking already-revoked grant returns 404
  const secondRevoke = await call(
    `/api/connections/conn_active/workspaces/${ws1.id}`,
    'DELETE',
    context,
  );
  assert.equal(secondRevoke.status, 404);

  db.close();
});
