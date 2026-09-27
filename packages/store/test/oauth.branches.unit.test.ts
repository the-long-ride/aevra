import test from 'node:test';
import assert from 'node:assert/strict';
import { AevraDatabase } from '../src/database.js';
import { OAuthRepository } from '../src/oauth.js';
import { clientFromRow, connectionFromRow } from '../src/oauth-records.js';

const RESOURCE = 'https://mcp.example.com/mcp';

function setup(start = '2026-09-01T00:00:00.000Z') {
  const clock = { now: Date.parse(start) };
  const db = AevraDatabase.open(':memory:');
  const repo = new OAuthRepository(db.raw(), () => new Date(clock.now));
  const client = repo.registerClient({ clientName: 'Sample', redirectUris: ['https://a.test/cb'] });
  const grant = {
    clientId: client.clientId,
    actor: 'oauth:Sample',
    subject: 'oauth_grant_sample',
    scope: 'mcp',
    resource: RESOURCE,
  };
  return { clock, db, repo, client, grant };
}

function request(repo: OAuthRepository, clientId: string, extra: Record<string, unknown> = {}) {
  return repo.createAuthorizationRequest(
    {
      clientId,
      redirectUri: 'https://a.test/cb',
      scope: 'mcp',
      resource: RESOURCE,
      codeChallenge: 'challenge',
      codeChallengeMethod: 'S256',
      ...extra,
    },
    60_000,
  );
}

test('default clock, unknown client lookup and client listing', () => {
  const db = AevraDatabase.open(':memory:');
  const repo = new OAuthRepository(db.raw());
  const before = Date.now();
  const client = repo.registerClient({ clientName: 'Default', redirectUris: [] });
  assert.ok(Date.parse(client.createdAt) >= before - 1000);
  assert.equal(repo.getClient('oauth_client_missing'), null);
  assert.deepEqual(
    repo.listClients().map((c) => c.clientName),
    ['Default'],
  );
  db.close();
});

test('authorization requests without optional fields persist nulls and renewable flags', () => {
  const { db, repo, client } = setup();
  const plain = request(repo, client.clientId);
  const stored = repo.getAuthorizationRequest(plain.id)!;
  assert.equal(stored.state, null);
  assert.equal(stored.remoteIp, null);
  assert.equal(stored.renewable, true);
  const fixed = request(repo, client.clientId, { renewable: false });
  assert.equal(repo.getAuthorizationRequest(fixed.id)?.renewable, false);
  assert.equal(
    repo.listPendingAuthorizationRequests().find((r) => r.id === fixed.id)?.renewable,
    false,
  );
  assert.equal(repo.getAuthorizationRequest('oauth_req_missing'), null);
  db.close();
});

test('decisions: missing request yields null and explicit renewable overrides stored value', () => {
  const { db, repo, client } = setup();
  assert.equal(repo.approveAuthorizationRequest('oauth_req_missing'), null);
  const req = request(repo, client.clientId);
  const approved = repo.approveAuthorizationRequest(req.id, { renewable: false });
  assert.equal(approved?.status, 'APPROVED');
  assert.equal(approved?.renewable, false);
  // Once decided, a second decision does not change status.
  assert.equal(repo.denyAuthorizationRequest(req.id)?.status, 'APPROVED');
  const issued = repo.issueAuthorizationCode(req.id, 60_000);
  const consumed = repo.consumeAuthorizationCode(issued.code)!;
  assert.equal(consumed.renewable, false);
  assert.equal(consumed.actor, 'oauth:Sample');
  assert.match(consumed.subject, /^oauth_grant_/);
  db.close();
});

test('issuing a code requires an approved, live request', () => {
  const { clock, db, repo, client } = setup();
  const pending = request(repo, client.clientId);
  assert.throws(() => repo.issueAuthorizationCode(pending.id, 1_000), /not approved/);
  assert.throws(() => repo.issueAuthorizationCode('oauth_req_missing', 1_000), /not approved/);
  const approved = request(repo, client.clientId);
  repo.approveAuthorizationRequest(approved.id);
  clock.now += 120_000;
  assert.throws(() => repo.issueAuthorizationCode(approved.id, 1_000), /not approved/);
  db.close();
});

test('authorization codes: unknown and expired codes are rejected and expired codes deleted', () => {
  const { clock, db, repo, client } = setup();
  assert.equal(repo.consumeAuthorizationCode('not a real code'), null);
  const req = request(repo, client.clientId);
  repo.approveAuthorizationRequest(req.id);
  const issued = repo.issueAuthorizationCode(req.id, 1_000);
  clock.now += 5_000;
  assert.equal(repo.consumeAuthorizationCode(issued.code), null);
  const left = db.raw().prepare('SELECT COUNT(*) n FROM oauth_authorization_codes').get() as any;
  assert.equal(Number(left.n), 0);
  db.close();
});

test('connection lifecycle wrappers update and read state', () => {
  const { clock, db, repo, grant } = setup();
  assert.equal(repo.getConnection(grant.subject), null);
  repo.issueAccessToken(grant, 60_000);
  const created = repo.getConnection(grant.subject)!;
  assert.equal(created.status, 'ACTIVE');
  assert.equal(created.yoloEnabled, false);
  assert.equal(created.revokedAt, undefined);

  clock.now += 1_000;
  repo.touchConnection(grant.subject);
  assert.equal(repo.getConnection(grant.subject)!.lastUsedAt, new Date(clock.now).toISOString());
  assert.equal(repo.setConnectionYolo(grant.subject, true), true);
  assert.equal(repo.getConnection(grant.subject)!.yoloEnabled, true);
  assert.equal(repo.setConnectionYolo('unknown subject', true), false);

  repo.markConnectionGrace(grant.subject, '2026-09-01T00:00:02.000Z', '2026-09-01T00:05:00.000Z');
  let conn = repo.getConnection(grant.subject)!;
  assert.equal(conn.disconnectedAt, '2026-09-01T00:00:02.000Z');
  assert.equal(conn.graceExpiresAt, '2026-09-01T00:05:00.000Z');
  repo.clearConnectionGrace(grant.subject);
  conn = repo.getConnection(grant.subject)!;
  assert.equal(conn.graceExpiresAt, undefined);
  assert.equal(conn.disconnectedAt, '2026-09-01T00:00:02.000Z');
  repo.markConnectionGrace(grant.subject, '2026-09-01T00:00:03.000Z', '2026-09-01T00:06:00.000Z');
  repo.markConnectionConnected(grant.subject);
  conn = repo.getConnection(grant.subject)!;
  assert.equal(conn.disconnectedAt, undefined);
  assert.equal(conn.graceExpiresAt, undefined);
  assert.equal(repo.listConnections().length, 1);
  db.close();
});

test('revoking a connection revokes credentials and blocks new tokens', () => {
  const { db, repo, grant } = setup();
  const access = repo.issueAccessToken(grant, 60_000);
  const refresh = repo.issueRefreshToken(grant, 60_000);
  const family = repo.getLatestRefreshFamily(grant.subject)!;
  assert.equal(family.status, 'ACTIVE');
  assert.equal(family.revokeReason, undefined);
  repo.revokeConnection(grant.subject, 'USER_REVOKED');
  assert.equal(repo.findAccessToken(access.token), null);
  assert.equal(repo.findRefreshToken(refresh.token)?.status, 'REVOKED');
  assert.ok(repo.findRefreshToken(refresh.token)?.revokedAt);
  const revokedFamily = repo.getLatestRefreshFamily(grant.subject)!;
  assert.equal(revokedFamily.status, 'REVOKED');
  assert.equal(revokedFamily.revokeReason, 'USER_REVOKED');
  assert.ok(revokedFamily.revokedAt);
  const conn = repo.getConnection(grant.subject)!;
  assert.equal(conn.status, 'REVOKED');
  assert.equal(conn.revokeReason, 'USER_REVOKED');
  assert.throws(() => repo.issueAccessToken(grant, 1_000), /revoked/);
  assert.throws(() => repo.issueRefreshToken(grant, 1_000), /revoked/);
  assert.equal(repo.getLatestRefreshFamily('no such subject'), null);
  db.close();
});

test('connection binding mismatch is rejected', () => {
  const { db, repo, grant } = setup();
  repo.ensureConnection(grant);
  assert.throws(
    () => repo.ensureConnection({ ...grant, resource: 'https://other.test/mcp' }),
    /binding mismatch/,
  );
  assert.throws(() => repo.ensureConnection({ ...grant, actor: 'oauth:Else' }), /binding mismatch/);
  db.close();
});

test('refresh families: reuse, revoked, foreign and expired families are rejected', () => {
  const { clock, db, repo, grant } = setup();
  const first = repo.issueRefreshToken(grant, 10_000);
  const second = repo.issueRefreshToken(grant, 10_000, first.record.familyId);
  assert.equal(second.record.familyId, first.record.familyId);
  assert.equal(second.record.expiresAt, first.record.expiresAt);

  const other = { ...grant, subject: 'oauth_grant_other' };
  assert.throws(
    () => repo.issueRefreshToken(other, 10_000, first.record.familyId),
    /invalid refresh token family/,
  );
  repo.revokeRefreshFamily(first.record.familyId, 'TEST');
  assert.equal(repo.findRefreshToken(first.token)?.status, 'REVOKED');
  assert.throws(
    () => repo.issueRefreshToken(grant, 10_000, first.record.familyId),
    /invalid refresh token family/,
  );

  const fresh = repo.issueRefreshToken(grant, 10_000);
  clock.now += 20_000;
  assert.throws(
    () => repo.issueRefreshToken(grant, 10_000, fresh.record.familyId),
    /invalid refresh token family/,
  );
  // Expired refresh lookup revokes the whole family.
  assert.equal(repo.findRefreshToken(fresh.token), null);
  const row = db.raw().prepare('SELECT revoke_reason r FROM oauth_refresh_families WHERE family_id=?').get(fresh.record.familyId) as any;
  assert.equal(row.r, 'EXPIRED');
  db.close();
});

test('refresh rotation rejects unknown, expired, revoked and orphaned tokens', () => {
  const { clock, db, repo, grant } = setup();
  assert.equal(repo.rotateRefreshTokenSecurely('not a real value', 1_000).status, 'INVALID');
  assert.equal(repo.findRefreshToken('not a real value'), null);
  assert.equal(repo.findAccessToken('not a real value'), null);

  const revoked = repo.issueRefreshToken(grant, 60_000);
  repo.revokeToken(revoked.token);
  assert.equal(repo.rotateRefreshTokenSecurely(revoked.token, 1_000).status, 'INVALID');

  const orphan = repo.issueRefreshToken(grant, 60_000);
  db.raw()
    .prepare('DELETE FROM oauth_refresh_families WHERE family_id=?')
    .run(orphan.record.familyId);
  assert.equal(repo.rotateRefreshTokenSecurely(orphan.token, 1_000).status, 'INVALID');

  const expiring = repo.issueRefreshToken(grant, 5_000);
  clock.now += 10_000;
  assert.equal(repo.rotateRefreshTokenSecurely(expiring.token, 1_000).status, 'INVALID');
  const fam = db
    .raw()
    .prepare('SELECT status,revoke_reason r FROM oauth_refresh_families WHERE family_id=?')
    .get(expiring.record.familyId) as any;
  assert.equal(fam.status, 'REVOKED');
  assert.equal(fam.r, 'EXPIRED');
  db.close();
});

test('connection origins: empty inputs are ignored and repeated origins are deduplicated', () => {
  const { clock, db, repo, grant } = setup();
  repo.ensureConnection(grant);
  repo.recordConnectionOrigin('', '203.0.113.1');
  repo.recordConnectionOrigin(grant.subject, '');
  assert.deepEqual(repo.listConnectionOrigins(''), []);
  assert.deepEqual(repo.listConnectionOrigins(grant.subject), []);
  repo.recordConnectionOrigin(grant.subject, '203.0.113.1');
  clock.now += 1_000;
  repo.recordConnectionOrigin(grant.subject, '203.0.113.1');
  const list = repo.listConnectionOrigins(grant.subject);
  assert.deepEqual(list, [{ remoteIp: '203.0.113.1', lastSeenAt: new Date(clock.now).toISOString() }]);
  // Entries older than 24h drop out of the list.
  assert.deepEqual(repo.listConnectionOrigins(grant.subject, '2026-09-03T00:00:00.000Z'), []);
  repo.clearRememberedWorkspaceGrants(grant.subject);
  db.close();
});

test('record mappers default missing JSON and keep optional connection fields', () => {
  const client = clientFromRow({ clientId: 1, clientName: 'N', createdAt: 'x' });
  assert.deepEqual(client.redirectUris, []);
  assert.deepEqual(client.grantTypes, []);
  assert.deepEqual(clientFromRow({ redirectUrisJson: '{"a":1}' }).redirectUris, []);
  const conn = connectionFromRow({
    clientId: 'c',
    actor: 'a',
    subject: 's',
    scope: 'mcp',
    resource: 'r',
    status: 'REVOKED',
    yoloEnabled: 1,
    createdAt: 't0',
    lastUsedAt: 't1',
    revokedAt: 't2',
    revokeReason: 'why',
    disconnectedAt: 't3',
    graceExpiresAt: 't4',
  });
  assert.equal(conn.yoloEnabled, true);
  assert.equal(conn.revokedAt, 't2');
  assert.equal(conn.revokeReason, 'why');
  assert.equal(conn.disconnectedAt, 't3');
  assert.equal(conn.graceExpiresAt, 't4');
});
