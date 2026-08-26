import assert from 'node:assert/strict';
import test from 'node:test';
import { AevraDatabase } from '../../../packages/store/src/database.js';
import { OAuthRepository } from '../../../packages/store/src/oauth.js';
import { SessionRepository } from '../../../packages/store/src/sessions.js';
import { CapabilityProfileService } from '../src/policy/capabilities.js';
import { ConnectionStateStore } from '../src/sessions/connection-state.js';
import { SessionManager } from '../src/sessions/session-manager.js';

function fixture() {
  let now = Date.parse('2026-08-26T00:00:00.000Z');
  const clock = { now: () => new Date(now) };
  const db = AevraDatabase.open(':memory:');
  const oauthRepo = new OAuthRepository(db.raw(), clock.now);
  const sessionRepo = new SessionRepository(db.raw());
  const profiles = new CapabilityProfileService(db.raw());
  const subject = 'oauth_grant_continuity';
  const identity = {
    actor: 'oauth:ChatGPT',
    subject,
    connectionId: subject,
    issuer: 'https://mcp.example.com',
    audience: 'https://mcp.example.com/mcp',
    expiresAt: '2099-01-01T00:00:00.000Z',
  };
  oauthRepo.ensureConnection({
    clientId: oauthRepo.registerClient({
      clientName: 'ChatGPT',
      redirectUris: ['https://chatgpt.com/oauth/callback'],
    }).clientId,
    actor: identity.actor,
    subject,
    resource: identity.audience,
    scope: 'mcp offline_access',
  });
  const createManager = () =>
    new SessionManager(
      sessionRepo,
      profiles,
      30 * 60_000,
      clock,
      new ConnectionStateStore(oauthRepo, clock),
      15 * 60_000,
    );
  return {
    db,
    oauthRepo,
    sessionRepo,
    identity,
    clock,
    createManager,
    advance(ms: number) {
      now += ms;
    },
  };
}

function addWorkspace(db: AevraDatabase, id = 'workspace-continuity') {
  const at = new Date().toISOString();
  db.raw()
    .prepare(
      'INSERT INTO workspaces(id,name,description,host_root,created_at,updated_at) VALUES(?,?,?,?,?,?)',
    )
    .run(id, id, '', `/tmp/${id}`, at, at);
  return id;
}

test('OAuth reconnect creates a new MCP session and restores connection YOLO', () => {
  const { db, identity, createManager, advance } = fixture();
  const manager = createManager();
  const first = manager.getOrCreateForIdentity(identity);
  assert.equal(first.mode, 'created');
  manager.enableYolo(first.session.id);

  manager.detach(first.session.id);
  advance(14 * 60_000);
  const resumed = manager.getOrCreateForIdentity(identity);

  assert.equal(resumed.mode, 'resumed');
  assert.notEqual(resumed.session.id, first.session.id);
  assert.equal(manager.isYolo(resumed.session.id), true);

  manager.detach(resumed.session.id);
  advance(16 * 60_000);
  manager.expireGraceConnections();
  const fresh = manager.getOrCreateForIdentity(identity);
  assert.equal(fresh.mode, 'created');
  assert.equal(manager.isYolo(fresh.session.id), true);
  db.close();
});

test('session-only workspace lease is rebound only while the original lease is valid', () => {
  const { db, identity, createManager, advance } = fixture();
  const workspaceId = addWorkspace(db);
  const manager = createManager();
  const first = manager.getOrCreateForIdentity(identity).session;
  const admitted = manager.admitWorkspace(first.id, workspaceId, 'coding-session');
  assert.equal(admitted.status, 'admitted');
  if (admitted.status !== 'admitted') throw new Error('expected admitted lease');
  const originalExpiry = admitted.lease.expiresAt;

  manager.detach(first.id);
  advance(5 * 60_000);
  const resumed = manager.getOrCreateForIdentity(identity);
  const rebound = manager.leaseForWorkspace(resumed.session.id, workspaceId);
  assert.equal(resumed.mode, 'resumed');
  assert.equal(rebound?.expiresAt, originalExpiry);

  manager.detach(resumed.session.id);
  advance(31 * 60_000);
  manager.expireGraceConnections();
  const fresh = manager.getOrCreateForIdentity(identity);
  assert.equal(fresh.mode, 'created');
  assert.equal(manager.leaseForWorkspace(fresh.session.id, workspaceId), null);
  db.close();
});

test('restart keeps OAuth connection YOLO and remembered grants but invalidates MCP sessions', () => {
  const { db, sessionRepo, identity, createManager } = fixture();
  const workspaceId = addWorkspace(db, 'remembered-workspace');
  sessionRepo.rememberWorkspaceGrant(identity.subject, workspaceId, 'read-only');
  const beforeRestart = createManager();
  const first = beforeRestart.getOrCreateForIdentity(identity).session;
  beforeRestart.enableYolo(first.id);
  assert.ok(beforeRestart.leaseForWorkspace(first.id, workspaceId));

  beforeRestart.invalidateForRestart();
  const afterRestart = createManager();
  const next = afterRestart.getOrCreateForIdentity(identity);

  assert.equal(afterRestart.get(first.id), null);
  assert.equal(next.mode, 'created');
  assert.equal(afterRestart.isYolo(next.session.id), true);
  assert.ok(afterRestart.leaseForWorkspace(next.session.id, workspaceId));
  db.close();
});

test('remembered workspace authorization survives reconnect after grace expires', () => {
  const { db, sessionRepo, identity, createManager, advance } = fixture();
  const workspaceId = addWorkspace(db, 'long-gap-workspace');
  sessionRepo.rememberWorkspaceGrant(identity.subject, workspaceId, 'read-only');
  const manager = createManager();
  const first = manager.getOrCreateForIdentity(identity).session;
  assert.ok(manager.leaseForWorkspace(first.id, workspaceId));

  manager.detach(first.id);
  advance(16 * 60_000);
  manager.expireGraceConnections();
  const reconnected = manager.getOrCreateForIdentity(identity);

  assert.equal(reconnected.mode, 'created');
  assert.notEqual(reconnected.session.id, first.id);
  assert.ok(manager.leaseForWorkspace(reconnected.session.id, workspaceId));
  db.close();
});
test('connection state becomes OFFLINE after reconnect grace expires without a new session', () => {
  const { db, oauthRepo, identity, clock, advance } = fixture();
  const state = new ConnectionStateStore(oauthRepo, clock);
  assert.equal(state.attach('ses-edge', identity)?.status, 'CONNECTED');
  assert.equal(state.detach('ses-edge', 60_000)?.status, 'GRACE');

  advance(60_001);
  assert.deepEqual(state.expireGraceConnections(), [identity.connectionId]);
  assert.equal(state.state(identity.connectionId)?.status, 'OFFLINE');
  assert.equal(oauthRepo.getConnection(identity.connectionId)?.disconnectedAt != null, true);
  assert.equal(oauthRepo.getConnection(identity.connectionId)?.graceExpiresAt, undefined);
  db.close();
});

test('connection state rejects missing or mismatched identity and handles unbound sessions', () => {
  const { db, oauthRepo, identity, clock } = fixture();
  const state = new ConnectionStateStore(oauthRepo, clock);
  const withoutConnection = { ...identity, connectionId: undefined };

  assert.equal(state.attach('no-connection', withoutConnection), null);
  assert.equal(state.connectionIdForSession('missing'), null);
  assert.equal(state.detach('missing', 60_000), null);
  assert.equal(state.resolutionMode(withoutConnection), 'created');
  assert.equal(state.state('missing'), null);
  assert.throws(() => state.setYolo('missing', true), /not active/);
  assert.throws(
    () => state.attach('bad', { ...identity, actor: 'oauth:Claude' }),
    /identity mismatch/,
  );
  db.close();
});
