import assert from 'node:assert/strict';
import test from 'node:test';
import { AevraDatabase } from '../../../packages/store/src/database.js';
import { OAuthRepository } from '../../../packages/store/src/oauth.js';
import { SessionRepository } from '../../../packages/store/src/sessions.js';
import { CapabilityProfileService } from '../src/policy/capabilities.js';
import { SessionManager } from '../src/sessions/session-manager.js';
import { ConnectionStateStore } from '../src/sessions/connection-state.js';
import { ConnectionAdminService } from '../src/admin/connection-admin.js';

function makeFixture() {
  const db = AevraDatabase.open(':memory:');
  const oauthRepo = new OAuthRepository(db.raw());
  const sessionRepo = new SessionRepository(db.raw());
  const profiles = new CapabilityProfileService(db.raw());
  const connState = new ConnectionStateStore(oauthRepo);
  const sessions = new SessionManager(sessionRepo, profiles, 60_000, undefined, connState);

  // Register an OAuth client and connection
  const client = oauthRepo.registerClient({
    clientName: 'ChatGPT',
    redirectUris: ['https://chatgpt.com/callback'],
  });

  oauthRepo.ensureConnection({
    clientId: client.clientId,
    actor: 'oauth:ChatGPT',
    resource: 'https://aevra.local',
    scope: 'read write',
    subject: 'conn_rotate_1',
  });

  const connectionAdmin = new ConnectionAdminService(oauthRepo, sessions, 3600);

  return {
    db,
    oauthRepo,
    sessionRepo,
    sessions,
    connectionAdmin,
  };
}

const makeIdentity = (subject = 'conn_rotate_1', connectionId = 'conn_rotate_1') => ({
  actor: 'oauth:ChatGPT',
  subject,
  connectionId,
  issuer: 'https://example.com',
  audience: 'https://example.com/mcp',
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
});

test('N4: Same-session IP rotation updates session remoteIp and connection projection', () => {
  const f = makeFixture();
  try {
    const identity = makeIdentity();

    // 1. Initial session created from 192.0.2.1
    const { session: s1, mode: m1 } = f.sessions.getOrCreateForIdentity(identity, '192.0.2.1');
    assert.equal(m1, 'created');
    assert.equal(s1.remoteIp, '192.0.2.1');

    // Record initial origin
    f.oauthRepo.recordConnectionOrigin(
      'conn_rotate_1',
      '192.0.2.1',
      new Date(Date.now() - 5_000).toISOString(),
    );

    let proj = f.connectionAdmin.list().find((c) => c.connectionId === 'conn_rotate_1');
    assert.equal(proj?.remoteIp, '192.0.2.1');

    // 2. Same session rotates IP to 192.0.2.99
    f.oauthRepo.recordConnectionOrigin('conn_rotate_1', '192.0.2.99', new Date().toISOString());
    const { session: s1Reused, mode: m2 } = f.sessions.getOrCreateForIdentity(
      identity,
      '192.0.2.99',
    );
    assert.equal(m2, 'existing');
    assert.equal(s1Reused.id, s1.id);
    assert.equal(
      s1Reused.remoteIp,
      '192.0.2.99',
      'reused session must update its remoteIp to latest observed IP',
    );

    // Connection projection must show latest IP 192.0.2.99
    proj = f.connectionAdmin.list().find((c) => c.connectionId === 'conn_rotate_1');
    assert.equal(
      proj?.remoteIp,
      '192.0.2.99',
      'connection remoteIp must project newest origin observation',
    );
    assert.equal(proj?.recentOrigins?.[0]?.remoteIp, '192.0.2.99');
  } finally {
    f.db.close();
  }
});

test('N4: Multiple sessions whose creation order differs from last-use order project newest IP', () => {
  const f = makeFixture();
  try {
    const id = makeIdentity();

    // Session 1 created from 192.0.2.1 at T-10s
    f.sessions.create(id, '192.0.2.1');
    f.oauthRepo.recordConnectionOrigin(
      'conn_rotate_1',
      '192.0.2.1',
      new Date(Date.now() - 10_000).toISOString(),
    );

    // Session 2 created from 192.0.2.2 at T-5s
    f.sessions.create(id, '192.0.2.2');
    f.oauthRepo.recordConnectionOrigin(
      'conn_rotate_1',
      '192.0.2.2',
      new Date(Date.now() - 5_000).toISOString(),
    );

    // New request comes from a rotating runner IP 192.0.2.50 at T-now
    f.oauthRepo.recordConnectionOrigin('conn_rotate_1', '192.0.2.50', new Date().toISOString());

    const proj = f.connectionAdmin.list().find((c) => c.connectionId === 'conn_rotate_1');
    assert.equal(
      proj?.remoteIp,
      '192.0.2.50',
      'connection remoteIp must reflect the newest origin observation',
    );
  } finally {
    f.db.close();
  }
});

test('N4: Offline projection retains origin history and falls back when origins expire', () => {
  const f = makeFixture();
  try {
    const id = makeIdentity();

    // Create session and record origin
    const { session } = f.sessions.getOrCreateForIdentity(id, '192.0.2.1');
    const now = Date.now();
    f.oauthRepo.recordConnectionOrigin('conn_rotate_1', '192.0.2.88', new Date(now).toISOString());

    // Disconnect session so connection becomes OFFLINE
    f.sessions.disconnect(session.id);
    f.sessions.expireGraceConnections();

    let proj = f.connectionAdmin.list().find((c) => c.connectionId === 'conn_rotate_1');
    assert.equal(proj?.sessionCount, 0);
    assert.ok(proj?.status === 'OFFLINE' || proj?.status === 'GRACE');
    assert.equal(
      proj?.remoteIp,
      '192.0.2.88',
      'offline connection projection retains latest origin IP',
    );

    // Clear origin history past 24h
    f.db
      .raw()
      .prepare('DELETE FROM oauth_connection_origins WHERE subject = ?')
      .run('conn_rotate_1');

    proj = f.connectionAdmin.list().find((c) => c.connectionId === 'conn_rotate_1');
    assert.equal(
      proj?.remoteIp,
      null,
      'offline connection with expired origins falls back to null',
    );
  } finally {
    f.db.close();
  }
});
