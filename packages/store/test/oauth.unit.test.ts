import test from 'node:test';
import assert from 'node:assert/strict';
import { AevraDatabase } from '../src/database.js';
import { OAuthRepository } from '../src/oauth.js';

test('OAuth repository stores client metadata and hashes bearer credentials', () => {
  const db = AevraDatabase.open(':memory:');
  const repo = new OAuthRepository(db.raw(), () => new Date('2026-08-17T12:00:00.000Z'));
  const client = repo.registerClient({
    clientName: 'ChatGPT',
    redirectUris: ['https://chatgpt.com/oauth/callback'],
  });
  assert.match(client.clientId, /^oauth_client_/);
  assert.deepEqual(client.redirectUris, ['https://chatgpt.com/oauth/callback']);

  const access = repo.issueAccessToken(
    {
      clientId: client.clientId,
      actor: 'oauth:ChatGPT',
      subject: client.clientId,
      scope: 'mcp offline_access',
      resource: 'https://mcp.example.com/mcp',
    },
    60_000,
  );
  const refresh = repo.issueRefreshToken(
    {
      clientId: client.clientId,
      actor: 'oauth:ChatGPT',
      subject: client.clientId,
      scope: 'mcp offline_access',
      resource: 'https://mcp.example.com/mcp',
    },
    120_000,
  );
  assert.ok(repo.findAccessToken(access.token));
  assert.ok(repo.findRefreshToken(refresh.token));

  const stored =
    JSON.stringify(db.raw().prepare('SELECT * FROM oauth_access_tokens').all()) +
    JSON.stringify(db.raw().prepare('SELECT * FROM oauth_refresh_tokens').all());
  assert.equal(stored.includes(access.token), false);
  assert.equal(stored.includes(refresh.token), false);
  db.close();
});

test('authorization codes are single-use and pending state is restart-invalidated', () => {
  let now = Date.parse('2026-08-17T12:00:00.000Z');
  const db = AevraDatabase.open(':memory:');
  const repo = new OAuthRepository(db.raw(), () => new Date(now));
  const client = repo.registerClient({
    clientName: 'ChatGPT',
    redirectUris: ['https://chatgpt.com/oauth/callback'],
  });
  const pending = repo.createAuthorizationRequest(
    {
      clientId: client.clientId,
      redirectUri: client.redirectUris[0]!,
      scope: 'mcp offline_access',
      resource: 'https://mcp.example.com/mcp',
      codeChallenge: 'challenge',
      codeChallengeMethod: 'S256',
      state: 'abc',
      remoteIp: '203.0.113.5',
    },
    60_000,
  );
  assert.equal(repo.listPendingAuthorizationRequests().length, 1);
  repo.approveAuthorizationRequest(pending.id);
  const issued = repo.issueAuthorizationCode(pending.id, 60_000);
  assert.ok(issued.code);
  assert.ok(repo.consumeAuthorizationCode(issued.code));
  assert.equal(repo.consumeAuthorizationCode(issued.code), null);

  repo.createAuthorizationRequest(
    {
      clientId: client.clientId,
      redirectUri: client.redirectUris[0]!,
      scope: 'mcp',
      resource: 'https://mcp.example.com/mcp',
      codeChallenge: 'challenge2',
      codeChallengeMethod: 'S256',
      remoteIp: '203.0.113.5',
    },
    60_000,
  );
  const second = repo.createAuthorizationRequest(
    {
      clientId: client.clientId,
      redirectUri: client.redirectUris[0]!,
      scope: 'mcp',
      resource: 'https://mcp.example.com/mcp',
      codeChallenge: 'challenge3',
      codeChallengeMethod: 'S256',
      remoteIp: '203.0.113.5',
    },
    60_000,
  );
  repo.approveAuthorizationRequest(second.id);
  repo.issueAuthorizationCode(second.id, 60_000);
  repo.invalidateEphemeralForRestart();
  assert.equal(repo.listPendingAuthorizationRequests().length, 0);
  assert.equal(
    Number(
      (db.raw().prepare('SELECT COUNT(*) count FROM oauth_authorization_codes').get() as any).count,
    ),
    0,
  );
  db.close();
});

test('access expiry and refresh rotation reject stale credentials', () => {
  let now = Date.parse('2026-08-17T12:00:00.000Z');
  const db = AevraDatabase.open(':memory:');
  const repo = new OAuthRepository(db.raw(), () => new Date(now));
  const client = repo.registerClient({
    clientName: 'ChatGPT',
    redirectUris: ['https://chatgpt.com/oauth/callback'],
  });
  const grant = {
    clientId: client.clientId,
    actor: 'oauth:ChatGPT',
    subject: client.clientId,
    scope: 'mcp offline_access',
    resource: 'https://mcp.example.com/mcp',
  };
  const access = repo.issueAccessToken(grant, 1_000);
  const refresh = repo.issueRefreshToken(grant, 10_000);
  now += 2_000;
  assert.equal(repo.findAccessToken(access.token), null);
  const rotated = repo.rotateRefreshToken(refresh.token, 10_000);
  assert.ok(rotated);
  assert.equal(repo.findRefreshToken(refresh.token), null);
  assert.ok(repo.findRefreshToken(rotated!.token));
  assert.equal(repo.rotateRefreshToken(refresh.token, 10_000), null);
  repo.revokeToken(rotated!.token);
  assert.equal(repo.findRefreshToken(rotated!.token), null);
  db.close();
});
