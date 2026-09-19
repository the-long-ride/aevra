import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AevraDatabase } from '../../../packages/store/src/database.js';
import { OAuthRepository } from '../../../packages/store/src/oauth.js';
import { SessionRepository } from '../../../packages/store/src/sessions.js';
import { WorkspaceRepository } from '../../../packages/store/src/workspaces.js';
import { CapabilityProfileService } from '../src/policy/capabilities.js';
import { ConnectionStateStore } from '../src/sessions/connection-state.js';
import { ConnectionWorkspaceGrantService } from '../src/sessions/connection-workspace-grants.js';
import { SessionManager } from '../src/sessions/session-manager.js';
import { WorkspaceService } from '../src/workspaces/workspace-service.js';

function make() {
  const db = AevraDatabase.open(':memory:');
  const wsRepo = new WorkspaceRepository(db.raw());
  const workspaceService = new WorkspaceService(wsRepo);
  const workspace = workspaceService.create({
    name: 'Aevra',
    hostRoot: mkdtempSync(path.join(os.tmpdir(), 'aevra-session-')),
  });
  const workspace2 = workspaceService.create({
    name: 'Docs',
    hostRoot: mkdtempSync(path.join(os.tmpdir(), 'aevra-session-docs-')),
  });
  const oauthRepo = new OAuthRepository(db.raw());
  const sessionRepo = new SessionRepository(db.raw());
  const profiles = new CapabilityProfileService(db.raw());
  const connectionState = new ConnectionStateStore(oauthRepo);
  const sessions = new SessionManager(
    sessionRepo,
    profiles,
    30 * 60_000,
    undefined,
    connectionState,
  );

  const grantService = new ConnectionWorkspaceGrantService({
    db: db.raw(),
    oauthRepo,
    workspaceRepo: wsRepo,
    sessionRepo,
    profiles,
    sessions: {
      matchingSessions: (connId) =>
        sessions.list().filter((s: any) => s.connectionId === connId || s.subject === connId),
      applyLease: (lease) => (sessions as any).leaseRows.set(lease.id, lease),
      revokeLease: (id) => sessions.revokeLease(id),
      leaseForWorkspace: (sid, wid) => sessions.leaseForWorkspace(sid, wid),
      revokeWorkspaceAcrossMatching: (connId, wid) => {
        for (const s of sessions.list()) {
          if (s.connectionId === connId || s.subject === connId) {
            const lease = sessions.leaseForWorkspace(s.id, wid);
            if (lease) sessions.revokeLease(lease.id);
          }
        }
      },
    },
  });

  return {
    db,
    workspace,
    workspace2,
    oauthRepo,
    sessionRepo,
    wsRepo,
    profiles,
    sessions,
    grantService,
  };
}

function ensureActiveConnection(
  oauthRepo: OAuthRepository,
  subject: string,
  actor = 'oauth:ChatGPT',
) {
  const client =
    oauthRepo.listClients().find((c) => c.clientName === 'ChatGPT') ??
    oauthRepo.registerClient({ clientName: 'ChatGPT', redirectUris: ['https://mcp.example.com'] });
  oauthRepo.ensureConnection({
    clientId: client.clientId,
    actor,
    subject,
    scope: 'mcp',
    resource: 'https://mcp.example.com',
  });
}

test('OAuth auto-admission remembers workspace and profile across MCP reconnect', async () => {
  const x = make();
  x.profiles.mapActor('oauth:ChatGPT', x.workspace.id, 'read-only', 'auto');
  const identity = {
    actor: 'oauth:ChatGPT',
    subject: 'grant-a',
    issuer: 'i',
    audience: 'a',
    expiresAt: 'x',
  };
  const first = x.sessions.create(identity);
  const admitted = await x.sessions.switchWorkspace(first.id, x.workspace.id);
  assert.equal(admitted.status, 'admitted');
  x.sessions.disconnect(first.id);
  const second = x.sessions.create(identity);
  assert.equal(x.sessions.activeLease(second.id)?.workspaceId, x.workspace.id);
  assert.deepEqual(
    x.sessions.activeLease(second.id)?.capabilities,
    x.profiles.get('read-only')?.capabilities,
  );
  x.db.close();
});

test('connection coding profile wins over a lower persistent mapping on reconnect', async () => {
  const x = make();
  x.profiles.mapActor('oauth:ChatGPT', x.workspace.id, 'read-only', 'auto');
  const identity = {
    actor: 'oauth:ChatGPT',
    subject: 'grant-b',
    issuer: 'i',
    audience: 'a',
    expiresAt: 'x',
  };
  const first = x.sessions.create(identity);
  await x.sessions.switchWorkspace(first.id, x.workspace.id);
  x.sessions.grantConnectionWorkspace(first.id, x.workspace.id, 'coding-session');
  x.sessions.disconnect(first.id);
  const second = x.sessions.create(identity);
  const lease = x.sessions.activeLease(second.id)!;
  assert.ok(lease.capabilities.includes('files.write'));
  assert.ok(lease.capabilities.includes('commands.run'));
  x.db.close();
});

test('explicit offline grant followed by reconnect restores lease to subsequent runner', () => {
  const x = make();
  const connId = 'conn_offline_1';
  ensureActiveConnection(x.oauthRepo, connId);

  // Grant offline when 0 sessions exist
  const result = x.grantService.grant({
    connectionId: connId,
    workspaceId: x.workspace.id,
    profileId: 'coding-session',
  });
  assert.deepEqual(result.appliedSessionIds, []);
  assert.equal(result.grant.workspaceId, x.workspace.id);

  // When VM connects later, lease is restored automatically
  const identity = {
    actor: 'oauth:ChatGPT',
    subject: connId,
    connectionId: connId,
    issuer: 'i',
    audience: 'a',
    expiresAt: '2099-01-01T00:00:00.000Z',
  };
  const session = x.sessions.create(identity, '198.51.100.1');
  const lease = x.sessions.activeLease(session.id);
  assert.ok(lease);
  assert.equal(lease.workspaceId, x.workspace.id);
  assert.ok(lease.capabilities.includes('files.write'));

  x.db.close();
});

test('grant A then B retains both grants; removing A leaves B surviving', () => {
  const x = make();
  const connId = 'conn_multi_grants';
  ensureActiveConnection(x.oauthRepo, connId);

  x.grantService.grant({
    connectionId: connId,
    workspaceId: x.workspace.id,
    profileId: 'read-only',
  });
  x.grantService.grant({
    connectionId: connId,
    workspaceId: x.workspace2.id,
    profileId: 'coding-session',
  });

  const list = x.grantService.list(connId);
  assert.equal(list.length, 2);
  assert.ok(list.some((g) => g.workspaceId === x.workspace.id && g.profileId === 'read-only'));
  assert.ok(
    list.some((g) => g.workspaceId === x.workspace2.id && g.profileId === 'coding-session'),
  );

  // Removing workspace A
  const removeRes = x.grantService.remove(connId, x.workspace.id);
  assert.equal(removeRes.removed, true);

  const remaining = x.grantService.list(connId);
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0]?.workspaceId, x.workspace2.id);

  x.db.close();
});

test('profile downgrade updates live sessions synchronously to reduced capabilities', () => {
  const x = make();
  const connId = 'conn_downgrade';
  ensureActiveConnection(x.oauthRepo, connId);

  const identity = {
    actor: 'oauth:ChatGPT',
    subject: connId,
    connectionId: connId,
    issuer: 'i',
    audience: 'a',
    expiresAt: '2099-01-01T00:00:00.000Z',
  };
  const s1 = x.sessions.create(identity, '10.0.0.1');
  const s2 = x.sessions.create(identity, '10.0.0.2');

  // Initial grant: coding-session
  x.grantService.grant({
    connectionId: connId,
    workspaceId: x.workspace.id,
    profileId: 'coding-session',
  });
  assert.ok(x.sessions.activeLease(s1.id)?.capabilities.includes('files.write'));
  assert.ok(x.sessions.activeLease(s2.id)?.capabilities.includes('files.write'));

  // Downgrade to read-only
  x.grantService.grant({
    connectionId: connId,
    workspaceId: x.workspace.id,
    profileId: 'read-only',
  });
  const l1 = x.sessions.activeLease(s1.id)!;
  const l2 = x.sessions.activeLease(s2.id)!;
  assert.equal(
    l1.capabilities.includes('files.write'),
    false,
    'Capabilities must be replaced, not unioned',
  );
  assert.equal(
    l2.capabilities.includes('files.write'),
    false,
    'Capabilities must be replaced, not unioned',
  );
  assert.ok(l1.capabilities.includes('files.read'));

  x.db.close();
});

test('invalid connection, revoked connection, or missing workspace/profile reject without writes', () => {
  const x = make();
  const connId = 'conn_reject';
  ensureActiveConnection(x.oauthRepo, connId);

  // Missing workspace
  assert.throws(
    () =>
      x.grantService.grant({
        connectionId: connId,
        workspaceId: 'nonexistent',
        profileId: 'read-only',
      }),
    /workspace not found/,
  );

  // Missing profile
  assert.throws(
    () =>
      x.grantService.grant({
        connectionId: connId,
        workspaceId: x.workspace.id,
        profileId: 'nonexistent',
      }),
    /profile not found/,
  );

  // Nonexistent connection
  assert.throws(
    () =>
      x.grantService.grant({
        connectionId: 'ghost',
        workspaceId: x.workspace.id,
        profileId: 'read-only',
      }),
    /OAuth connection not found/,
  );

  // Revoked connection
  x.oauthRepo.revokeConnection(connId, 'TEST');
  assert.throws(
    () =>
      x.grantService.grant({
        connectionId: connId,
        workspaceId: x.workspace.id,
        profileId: 'read-only',
      }),
    /OAuth connection is not active/,
  );

  assert.equal(x.grantService.list(connId).length, 0);
  x.db.close();
});
