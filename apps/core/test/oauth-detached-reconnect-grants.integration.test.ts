import assert from 'node:assert/strict';
import test from 'node:test';
import { AevraDatabase } from '../../../packages/store/src/database.js';
import { OAuthRepository } from '../../../packages/store/src/oauth.js';
import { SessionRepository } from '../../../packages/store/src/sessions.js';
import { WorkspaceRepository } from '../../../packages/store/src/workspaces.js';
import { CapabilityProfileService } from '../src/policy/capabilities.js';
import { ConnectionStateStore } from '../src/sessions/connection-state.js';
import { ConnectionWorkspaceGrantService } from '../src/sessions/connection-workspace-grants.js';
import { SessionManager } from '../src/sessions/session-manager.js';
import { WorkspaceService } from '../src/workspaces/workspace-service.js';

function makeFixture() {
  const db = AevraDatabase.open(':memory:');
  const wsRepo = new WorkspaceRepository(db.raw());
  const workspaceService = new WorkspaceService(wsRepo);
  const ws1 = workspaceService.create({ name: 'Workspace1', hostRoot: '/tmp/ws1' });
  const ws2 = workspaceService.create({ name: 'Workspace2', hostRoot: '/tmp/ws2' });
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

  const client = oauthRepo.registerClient({
    clientName: 'ChatGPT',
    redirectUris: ['https://example.com/cb'],
  });
  oauthRepo.ensureConnection({
    clientId: client.clientId,
    actor: 'oauth:ChatGPT',
    subject: 'conn_1',
    scope: 'mcp',
    resource: 'https://example.com',
  });

  return { db, wsRepo, ws1, ws2, oauthRepo, sessionRepo, profiles, sessions, grantService };
}

const remoteIdentity = (subject = 'conn_1', connectionId = 'conn_1') => ({
  actor: 'oauth:ChatGPT',
  subject,
  connectionId,
  issuer: 'https://example.com',
  audience: 'https://example.com/mcp',
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
});

test('F1: Detach -> remove grant -> reconnect: no inherited lease without auto-admission', () => {
  const f = makeFixture();
  try {
    const { session: s1 } = f.sessions.getOrCreateForIdentity(remoteIdentity());
    f.grantService.grant({
      connectionId: 'conn_1',
      workspaceId: f.ws1.id,
      profileId: 'developer',
    });

    const initialLeases = f.sessions.leases(s1.id);
    assert.equal(initialLeases.length, 1);
    assert.equal(initialLeases[0]!.workspaceId, f.ws1.id);
    assert.ok(initialLeases[0]!.capabilities.includes('files.write'));

    // Detach session
    f.sessions.detach(s1.id);
    assert.equal(f.sessions.get(s1.id), null);

    // Remove grant while detached
    const result = f.grantService.remove('conn_1', f.ws1.id);
    assert.equal(result.removed, true);

    // Verify persisted grant and detached leases are removed
    assert.deepEqual(f.sessionRepo.listRememberedWorkspaceGrants('conn_1'), []);
    assert.equal(f.sessions.matchingLeasesForWorkspace('conn_1', f.ws1.id).length, 0);

    // Reconnect within grace period
    const { session: s2, mode } = f.sessions.getOrCreateForIdentity(remoteIdentity());
    assert.equal(mode, 'resumed');
    assert.notEqual(s2.id, s1.id);

    // Must NOT inherit lease for ws1
    const reconnectedLeases = f.sessions.leases(s2.id);
    assert.deepEqual(reconnectedLeases, []);
    assert.equal(f.sessions.activeLease(s2.id), null);
  } finally {
    f.db.close();
  }
});

test('F1: Detach -> downgrade profile -> reconnect: only downgraded capabilities', () => {
  const f = makeFixture();
  try {
    const { session: s1 } = f.sessions.getOrCreateForIdentity(remoteIdentity());
    f.grantService.grant({
      connectionId: 'conn_1',
      workspaceId: f.ws1.id,
      profileId: 'developer',
    });

    // Detach session
    f.sessions.detach(s1.id);

    // Downgrade profile to read-only while session is detached
    f.grantService.grant({
      connectionId: 'conn_1',
      workspaceId: f.ws1.id,
      profileId: 'read-only',
    });

    // Reconnect
    const { session: s2, mode } = f.sessions.getOrCreateForIdentity(remoteIdentity());
    assert.equal(mode, 'resumed');

    const leases = f.sessions.leases(s2.id);
    assert.equal(leases.length, 1);
    assert.equal(leases[0]!.workspaceId, f.ws1.id);
    assert.ok(!leases[0]!.capabilities.includes('files.write'));
    assert.ok(!leases[0]!.capabilities.includes('commands.run'));
    assert.ok(leases[0]!.capabilities.includes('files.read'));
  } finally {
    f.db.close();
  }
});

test('F1: Remove workspace A while workspace B remains granted: B survives', () => {
  const f = makeFixture();
  try {
    const { session: s1 } = f.sessions.getOrCreateForIdentity(remoteIdentity());
    f.grantService.grant({
      connectionId: 'conn_1',
      workspaceId: f.ws1.id,
      profileId: 'developer',
    });
    f.grantService.grant({
      connectionId: 'conn_1',
      workspaceId: f.ws2.id,
      profileId: 'read-only',
    });

    // Detach session
    f.sessions.detach(s1.id);

    // Remove only workspace 1
    f.grantService.remove('conn_1', f.ws1.id);

    // Reconnect
    const { session: s2, mode } = f.sessions.getOrCreateForIdentity(remoteIdentity());
    assert.equal(mode, 'resumed');

    const leases = f.sessions.leases(s2.id);
    assert.equal(leases.length, 1);
    assert.equal(leases[0]!.workspaceId, f.ws2.id);
    assert.ok(leases[0]!.capabilities.includes('files.read'));
  } finally {
    f.db.close();
  }
});

test('F1: Database failure rolls back both database and in-memory state', () => {
  const f = makeFixture();
  try {
    const { session: s1 } = f.sessions.getOrCreateForIdentity(remoteIdentity());
    f.grantService.grant({
      connectionId: 'conn_1',
      workspaceId: f.ws1.id,
      profileId: 'read-only',
    });

    // Inject failure into sessionRepo.revokeLease during grant update
    const origRevoke = f.sessionRepo.revokeLease.bind(f.sessionRepo);
    f.sessionRepo.revokeLease = () => {
      throw new Error('Simulated SQLite disk write failure');
    };

    assert.throws(
      () =>
        f.grantService.grant({
          connectionId: 'conn_1',
          workspaceId: f.ws1.id,
          profileId: 'developer',
        }),
      /Simulated SQLite disk write failure/,
    );

    // Restore method
    f.sessionRepo.revokeLease = origRevoke;

    // Verify DB still has read-only grant, not developer
    const persisted = f.sessionRepo.listRememberedWorkspaceGrants('conn_1');
    assert.equal(persisted.length, 1);
    assert.equal(persisted[0]!.profileId, 'read-only');

    // Verify in-memory session lease is still read-only, not developer
    const currentLease = f.sessions.leaseForWorkspace(s1.id, f.ws1.id);
    assert.ok(currentLease);
    assert.ok(!currentLease.capabilities.includes('files.write'));

    // Inject failure during remove
    f.sessionRepo.revokeLease = () => {
      throw new Error('Simulated SQLite disk error on remove');
    };

    assert.throws(
      () => f.grantService.remove('conn_1', f.ws1.id),
      /Simulated SQLite disk error on remove/,
    );

    f.sessionRepo.revokeLease = origRevoke;

    // Persisted grant still exists
    assert.equal(f.sessionRepo.listRememberedWorkspaceGrants('conn_1').length, 1);
    // In-memory lease still exists
    assert.ok(f.sessions.leaseForWorkspace(s1.id, f.ws1.id));
  } finally {
    f.db.close();
  }
});
