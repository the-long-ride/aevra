import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { AevraDatabase } from '../../../packages/store/src/database.js';
import { OAuthRepository } from '../../../packages/store/src/oauth.js';
import { SessionRepository } from '../../../packages/store/src/sessions.js';
import { ConnectionAdminService } from '../src/admin/connection-admin.js';
import { AevraOAuthService } from '../src/auth/oauth.js';
import { CapabilityProfileService } from '../src/policy/capabilities.js';
import { ConnectionStateStore } from '../src/sessions/connection-state.js';
import { SessionManager } from '../src/sessions/session-manager.js';

const verifier = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~';
const challenge = createHash('sha256').update(verifier).digest().toString('base64url');
const issuer = 'https://mcp.example.com';
const resource = `${issuer}/mcp`;

function oauth(repo: OAuthRepository) {
  return new AevraOAuthService(repo, { issuer, resource });
}

function issueGrant(service: AevraOAuthService) {
  const client = service.registerClient({
    client_name: 'ChatGPT',
    redirect_uris: ['https://chatgpt.com/oauth/callback'],
  });
  const pending = service.beginAuthorization({
    client_id: client.client_id,
    redirect_uri: client.redirect_uris[0]!,
    response_type: 'code',
    scope: 'mcp offline_access',
    resource,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  service.approveAuthorization(pending.id);
  const { code } = service.continueAuthorization(pending.id);
  return {
    client,
    tokens: service.exchangeAuthorizationCode({
      grant_type: 'authorization_code',
      client_id: client.client_id,
      code,
      redirect_uri: client.redirect_uris[0]!,
      code_verifier: verifier,
      resource,
    }),
  };
}

function insertWorkspace(db: AevraDatabase, id: string) {
  const now = new Date().toISOString();
  db.raw()
    .prepare(
      'INSERT INTO workspaces(id,name,description,host_root,created_at,updated_at) VALUES(?,?,?,?,?,?)',
    )
    .run(id, id, '', `/tmp/${id}`, now, now);
}

function sessions(
  db: AevraDatabase,
  repo: OAuthRepository,
  sessionRepo = new SessionRepository(db.raw()),
) {
  return new SessionManager(
    sessionRepo,
    new CapabilityProfileService(db.raw()),
    30 * 60_000,
    undefined,
    new ConnectionStateStore(repo),
    15 * 60_000,
  );
}

test('OAuth connection, refresh family, grants and YOLO survive Core-style restart', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'aevra-continuity-'));
  const databasePath = path.join(directory, 'aevra.db');
  try {
    const firstDb = AevraDatabase.open(databasePath);
    const firstRepo = new OAuthRepository(firstDb.raw());
    const firstOAuth = oauth(firstRepo);
    const { client, tokens } = issueGrant(firstOAuth);
    const identity = firstOAuth.verifyAccessToken(tokens.access_token);
    const workspaceId = 'restart-workspace';
    insertWorkspace(firstDb, workspaceId);
    const firstSessions = sessions(firstDb, firstRepo);
    const firstSession = firstSessions.getOrCreateForIdentity(identity).session;
    firstSessions.enableYolo(firstSession.id);
    firstSessions.grantConnectionWorkspace(firstSession.id, workspaceId, 'read-only');
    assert.ok(firstSessions.leaseForWorkspace(firstSession.id, workspaceId));

    firstSessions.invalidateForRestart();
    firstRepo.invalidateEphemeralForRestart();
    firstDb.close();

    const secondDb = AevraDatabase.open(databasePath);
    try {
      const secondRepo = new OAuthRepository(secondDb.raw());
      const secondSessionRepo = new SessionRepository(secondDb.raw());
      const secondOAuth = oauth(secondRepo);
      const persisted = secondRepo.getConnection(identity.subject);
      assert.equal(persisted?.status, 'ACTIVE');
      assert.equal(persisted?.yoloEnabled, true);
      assert.equal(secondSessionRepo.listRememberedWorkspaceGrants(identity.subject).length, 1);
      const oldSession = secondDb
        .raw()
        .prepare('SELECT valid FROM sessions WHERE id=?')
        .get(firstSession.id) as any;
      assert.equal(Number(oldSession.valid), 0);

      const refreshed = secondOAuth.exchangeRefreshToken({
        grant_type: 'refresh_token',
        client_id: client.client_id,
        refresh_token: tokens.refresh_token!,
        resource,
      });
      const refreshedIdentity = secondOAuth.verifyAccessToken(refreshed.access_token);
      assert.equal(refreshedIdentity.connectionId, identity.connectionId);

      const secondSessions = sessions(secondDb, secondRepo, secondSessionRepo);
      const next = secondSessions.getOrCreateForIdentity(refreshedIdentity);
      assert.equal(next.mode, 'created');
      assert.notEqual(next.session.id, firstSession.id);
      assert.equal(secondSessions.isYolo(next.session.id), true);
      assert.ok(secondSessions.leaseForWorkspace(next.session.id, workspaceId));
    } finally {
      secondDb.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('Admin revoke kills access, refresh, sessions, YOLO and remembered grants', () => {
  const db = AevraDatabase.open(':memory:');
  try {
    const repo = new OAuthRepository(db.raw());
    const sessionRepo = new SessionRepository(db.raw());
    const service = oauth(repo);
    const { client, tokens } = issueGrant(service);
    const identity = service.verifyAccessToken(tokens.access_token);
    const workspaceId = 'revoke-workspace';
    insertWorkspace(db, workspaceId);
    const manager = sessions(db, repo, sessionRepo);
    const session = manager.getOrCreateForIdentity(identity).session;
    manager.enableYolo(session.id);
    manager.grantConnectionWorkspace(session.id, workspaceId, 'read-only');
    assert.equal(sessionRepo.listRememberedWorkspaceGrants(identity.subject).length, 1);

    const admin = new ConnectionAdminService(repo, manager, 3600);
    assert.equal(admin.revoke(identity.connectionId!), true);

    assert.equal(manager.get(session.id), null);
    assert.equal(repo.getConnection(identity.subject)?.status, 'REVOKED');
    assert.equal(repo.getConnection(identity.subject)?.yoloEnabled, false);
    assert.deepEqual(sessionRepo.listRememberedWorkspaceGrants(identity.subject), []);
    assert.throws(
      () => service.verifyAccessToken(tokens.access_token),
      /invalid OAuth access token/,
    );
    assert.throws(
      () =>
        service.exchangeRefreshToken({
          grant_type: 'refresh_token',
          client_id: client.client_id,
          refresh_token: tokens.refresh_token!,
          resource,
        }),
      /invalid refresh token/,
    );
  } finally {
    db.close();
  }
});
