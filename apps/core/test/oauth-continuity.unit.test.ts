import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { AevraDatabase } from '../../../packages/store/src/database.js';
import { OAuthRepository } from '../../../packages/store/src/oauth.js';
import { AevraOAuthService } from '../src/auth/oauth.js';

const challenge = (verifier: string) =>
  createHash('sha256').update(verifier).digest().toString('base64url');

function fixture() {
  let now = Date.parse('2026-08-17T12:00:00.000Z');
  const db = AevraDatabase.open(':memory:');
  const repo = new OAuthRepository(db.raw(), () => new Date(now));
  const service = new AevraOAuthService(repo, {
    issuer: 'https://mcp.example.com',
    resource: 'https://mcp.example.com/mcp',
    now: () => new Date(now),
  });
  return {
    db,
    repo,
    service,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

function issueGrant(service: AevraOAuthService, client: any, verifier: string) {
  const pending = service.beginAuthorization(
    {
      client_id: client.client_id,
      redirect_uri: client.redirect_uris[0]!,
      response_type: 'code',
      scope: 'mcp offline_access',
      resource: 'https://mcp.example.com/mcp',
      code_challenge: challenge(verifier),
      code_challenge_method: 'S256',
    },
    '203.0.113.4',
  );
  service.approveAuthorization(pending.id);
  const { code } = service.continueAuthorization(pending.id);
  return service.exchangeAuthorizationCode({
    grant_type: 'authorization_code',
    client_id: client.client_id,
    code,
    redirect_uri: client.redirect_uris[0]!,
    code_verifier: verifier,
    resource: 'https://mcp.example.com/mcp',
  });
}

function registerChatGpt(service: AevraOAuthService) {
  return service.registerClient({
    client_name: 'ChatGPT',
    redirect_uris: ['https://chatgpt.com/oauth/callback'],
  });
}

const verifier = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~';

test('OAuth refresh keeps one durable logical connection identity', () => {
  const { db, repo, service } = fixture();
  const client = registerChatGpt(service);
  const first = issueGrant(service, client, verifier);
  const original = service.verifyAccessToken(first.access_token);

  const refreshed = service.exchangeRefreshToken({
    grant_type: 'refresh_token',
    client_id: client.client_id,
    refresh_token: first.refresh_token!,
    resource: 'https://mcp.example.com/mcp',
  });
  const next = service.verifyAccessToken(refreshed.access_token);
  const connection = (repo as any).getConnection?.(original.subject) ?? null;

  assert.equal((original as any).connectionId, original.subject);
  assert.equal((next as any).connectionId, original.subject);
  assert.equal(next.subject, original.subject);
  assert.equal(connection?.subject, original.subject);
  assert.equal(connection?.status, 'ACTIVE');
  db.close();
});

test('replaying a spent refresh token revokes its whole family and active access tokens', () => {
  const { db, service } = fixture();
  const client = registerChatGpt(service);
  const first = issueGrant(service, client, verifier);
  const firstIdentity = service.verifyAccessToken(first.access_token);
  const second = service.exchangeRefreshToken({
    grant_type: 'refresh_token',
    client_id: client.client_id,
    refresh_token: first.refresh_token!,
    resource: 'https://mcp.example.com/mcp',
  });

  assert.throws(
    () =>
      service.exchangeRefreshToken({
        grant_type: 'refresh_token',
        client_id: client.client_id,
        refresh_token: first.refresh_token!,
        resource: 'https://mcp.example.com/mcp',
      }),
    /invalid refresh token/,
  );

  assert.throws(
    () =>
      service.exchangeRefreshToken({
        grant_type: 'refresh_token',
        client_id: client.client_id,
        refresh_token: second.refresh_token!,
        resource: 'https://mcp.example.com/mcp',
      }),
    /invalid refresh token/,
  );
  assert.throws(() => service.verifyAccessToken(first.access_token), /invalid OAuth access token/);
  assert.throws(() => service.verifyAccessToken(second.access_token), /invalid OAuth access token/);
  assert.equal(firstIdentity.subject.startsWith('oauth_grant_'), true);
  db.close();
});

test('refresh-family expiry is absolute and is not extended by rotation', () => {
  const { db, service, advance } = fixture();
  const client = registerChatGpt(service);
  const first = issueGrant(service, client, verifier);

  advance(29 * 24 * 60 * 60_000);
  const second = service.exchangeRefreshToken({
    grant_type: 'refresh_token',
    client_id: client.client_id,
    refresh_token: first.refresh_token!,
    resource: 'https://mcp.example.com/mcp',
  });

  advance(2 * 24 * 60 * 60_000);
  assert.throws(
    () =>
      service.exchangeRefreshToken({
        grant_type: 'refresh_token',
        client_id: client.client_id,
        refresh_token: second.refresh_token!,
        resource: 'https://mcp.example.com/mcp',
      }),
    /invalid refresh token/,
  );
  db.close();
});
