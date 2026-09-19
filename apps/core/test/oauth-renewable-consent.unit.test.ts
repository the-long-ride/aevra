import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { AevraDatabase } from '../../../packages/store/src/database.js';
import { OAuthRepository } from '../../../packages/store/src/oauth.js';
import { AevraOAuthService } from '../src/auth/oauth.js';

const b64url = (value: Buffer) => value.toString('base64url');
const challenge = (verifier: string) => b64url(createHash('sha256').update(verifier).digest());

function fixture() {
  let now = Date.parse('2026-09-18T12:00:00.000Z');
  const db = AevraDatabase.open(':memory:');
  const repo = new OAuthRepository(db.raw(), () => new Date(now));
  const auditEvents: any[] = [];
  const audit = {
    append(event: any) {
      auditEvents.push(event);
    },
  };
  const service = new AevraOAuthService(repo, {
    issuer: 'https://mcp.example.com',
    resource: 'https://mcp.example.com/mcp',
    now: () => new Date(now),
    audit,
  });
  return {
    db,
    repo,
    service,
    auditEvents,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

test('omitted scope with renewable=true issues refresh token and keeps scope mcp', () => {
  const { db, service, auditEvents } = fixture();
  const client = service.registerClient({
    client_name: 'ChatGPT',
    redirect_uris: ['https://chatgpt.com/oauth/callback'],
  });
  const verifier = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~';
  const pending = service.beginAuthorization({
    client_id: client.client_id,
    redirect_uri: client.redirect_uris[0]!,
    response_type: 'code',
    resource: 'https://mcp.example.com/mcp',
    code_challenge: challenge(verifier),
    code_challenge_method: 'S256',
  });

  service.approveAuthorization(pending.id, { renewable: true });
  const { code } = service.continueAuthorization(pending.id);
  const tokens = service.exchangeAuthorizationCode({
    grant_type: 'authorization_code',
    client_id: client.client_id,
    code,
    redirect_uri: client.redirect_uris[0]!,
    code_verifier: verifier,
    resource: 'https://mcp.example.com/mcp',
  });

  assert.equal(tokens.scope, 'mcp', 'Scope must not be expanded');
  assert.ok(tokens.refresh_token, 'Refresh token must be issued when renewable=true');

  const exchangeAudit = auditEvents.find((e) => e.operation === 'oauth.token.code_exchange');
  assert.ok(exchangeAudit);
  assert.equal(exchangeAudit.metadata.refreshIssued, true);
  assert.equal(exchangeAudit.metadata.grantedScope, 'mcp');

  db.close();
});

test('omitted scope with renewable=false (session-only) issues NO refresh token', () => {
  const { db, service, auditEvents } = fixture();
  const client = service.registerClient({
    client_name: 'ChatGPT',
    redirect_uris: ['https://chatgpt.com/oauth/callback'],
  });
  const verifier = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~';
  const pending = service.beginAuthorization({
    client_id: client.client_id,
    redirect_uri: client.redirect_uris[0]!,
    response_type: 'code',
    resource: 'https://mcp.example.com/mcp',
    code_challenge: challenge(verifier),
    code_challenge_method: 'S256',
  });

  service.approveAuthorization(pending.id, { renewable: false });
  const { code } = service.continueAuthorization(pending.id);
  const tokens = service.exchangeAuthorizationCode({
    grant_type: 'authorization_code',
    client_id: client.client_id,
    code,
    redirect_uri: client.redirect_uris[0]!,
    code_verifier: verifier,
    resource: 'https://mcp.example.com/mcp',
  });

  assert.equal(tokens.scope, 'mcp');
  assert.equal(tokens.refresh_token, undefined, 'Session-only grant must not issue refresh token');

  const exchangeAudit = auditEvents.find((e) => e.operation === 'oauth.token.code_exchange');
  assert.ok(exchangeAudit);
  assert.equal(exchangeAudit.metadata.refreshIssued, false);

  db.close();
});

test('scope mcp with renewable=true issues refresh token without scope expansion', () => {
  const { db, service } = fixture();
  const client = service.registerClient({
    client_name: 'ChatGPT',
    redirect_uris: ['https://chatgpt.com/oauth/callback'],
  });
  const verifier = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~';
  const pending = service.beginAuthorization({
    client_id: client.client_id,
    redirect_uri: client.redirect_uris[0]!,
    response_type: 'code',
    scope: 'mcp',
    resource: 'https://mcp.example.com/mcp',
    code_challenge: challenge(verifier),
    code_challenge_method: 'S256',
  });

  service.approveAuthorization(pending.id, { renewable: true });
  const { code } = service.continueAuthorization(pending.id);
  const tokens = service.exchangeAuthorizationCode({
    grant_type: 'authorization_code',
    client_id: client.client_id,
    code,
    redirect_uri: client.redirect_uris[0]!,
    code_verifier: verifier,
    resource: 'https://mcp.example.com/mcp',
  });

  assert.equal(tokens.scope, 'mcp');
  assert.ok(tokens.refresh_token);

  // Exchanging the refresh token without specifying scope keeps mcp
  const refreshed = service.exchangeRefreshToken({
    grant_type: 'refresh_token',
    client_id: client.client_id,
    refresh_token: tokens.refresh_token!,
    resource: 'https://mcp.example.com/mcp',
  });
  assert.equal(refreshed.scope, 'mcp');
  assert.ok(refreshed.refresh_token);
  assert.notEqual(refreshed.refresh_token, tokens.refresh_token);

  db.close();
});

test('scope mcp with renewable=false stays session-only', () => {
  const { db, service } = fixture();
  const client = service.registerClient({
    client_name: 'ChatGPT',
    redirect_uris: ['https://chatgpt.com/oauth/callback'],
  });
  const verifier = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~';
  const pending = service.beginAuthorization({
    client_id: client.client_id,
    redirect_uri: client.redirect_uris[0]!,
    response_type: 'code',
    scope: 'mcp',
    resource: 'https://mcp.example.com/mcp',
    code_challenge: challenge(verifier),
    code_challenge_method: 'S256',
  });

  service.approveAuthorization(pending.id, { renewable: false });
  const { code } = service.continueAuthorization(pending.id);
  const tokens = service.exchangeAuthorizationCode({
    grant_type: 'authorization_code',
    client_id: client.client_id,
    code,
    redirect_uri: client.redirect_uris[0]!,
    code_verifier: verifier,
    resource: 'https://mcp.example.com/mcp',
  });

  assert.equal(tokens.scope, 'mcp');
  assert.equal(tokens.refresh_token, undefined);
  db.close();
});

test('scope mcp offline_access with renewable=false reduces scope to mcp and stays session-only', () => {
  const { db, service } = fixture();
  const client = service.registerClient({
    client_name: 'ChatGPT',
    redirect_uris: ['https://chatgpt.com/oauth/callback'],
  });
  const verifier = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~';
  const pending = service.beginAuthorization({
    client_id: client.client_id,
    redirect_uri: client.redirect_uris[0]!,
    response_type: 'code',
    scope: 'mcp offline_access',
    resource: 'https://mcp.example.com/mcp',
    code_challenge: challenge(verifier),
    code_challenge_method: 'S256',
  });

  service.approveAuthorization(pending.id, { renewable: false });
  const { code } = service.continueAuthorization(pending.id);
  const tokens = service.exchangeAuthorizationCode({
    grant_type: 'authorization_code',
    client_id: client.client_id,
    code,
    redirect_uri: client.redirect_uris[0]!,
    code_verifier: verifier,
    resource: 'https://mcp.example.com/mcp',
  });

  assert.equal(tokens.scope, 'mcp', 'Scope must be reduced to exclude offline_access');
  assert.equal(tokens.refresh_token, undefined, 'Session-only must not issue refresh token');
  db.close();
});

test('scope mcp offline_access with default approval retains offline_access and issues refresh token', () => {
  const { db, service } = fixture();
  const client = service.registerClient({
    client_name: 'ChatGPT',
    redirect_uris: ['https://chatgpt.com/oauth/callback'],
  });
  const verifier = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~';
  const pending = service.beginAuthorization({
    client_id: client.client_id,
    redirect_uri: client.redirect_uris[0]!,
    response_type: 'code',
    scope: 'mcp offline_access',
    resource: 'https://mcp.example.com/mcp',
    code_challenge: challenge(verifier),
    code_challenge_method: 'S256',
  });

  service.approveAuthorization(pending.id);
  const { code } = service.continueAuthorization(pending.id);
  const tokens = service.exchangeAuthorizationCode({
    grant_type: 'authorization_code',
    client_id: client.client_id,
    code,
    redirect_uri: client.redirect_uris[0]!,
    code_verifier: verifier,
    resource: 'https://mcp.example.com/mcp',
  });

  assert.equal(tokens.scope, 'mcp offline_access');
  assert.ok(tokens.refresh_token);
  db.close();
});

test('refresh failures emit structured security audit events without secret tokens', () => {
  const { db, service, auditEvents } = fixture();
  const client = service.registerClient({
    client_name: 'ChatGPT',
    redirect_uris: ['https://chatgpt.com/oauth/callback'],
  });

  // Invalid refresh token binding
  assert.throws(
    () =>
      service.exchangeRefreshToken({
        grant_type: 'refresh_token',
        client_id: client.client_id,
        refresh_token: 'non_existent_token_value',
        resource: 'https://mcp.example.com/mcp',
      }),
    /invalid refresh token/,
  );

  const failureEvent = auditEvents.find((e) => e.operation === 'oauth.token.refresh_failed');
  assert.ok(failureEvent);
  assert.equal(failureEvent.result, 'rejected');
  assert.equal(failureEvent.class, 'security');
  assert.equal(failureEvent.metadata.reason, 'invalid_refresh_token_binding');
  // Ensure the actual token value was not logged
  assert.equal(JSON.stringify(failureEvent).includes('non_existent_token_value'), false);

  db.close();
});
