import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { AevraDatabase } from '../../../packages/store/src/database.js';
import { OAuthRepository } from '../../../packages/store/src/oauth.js';
import { AevraOAuthService } from '../src/auth/oauth.js';
import { resolvedResource, resourceMatches } from '../src/auth/oauth-helpers.js';

const verifier = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~';
const challenge = createHash('sha256').update(verifier).digest('base64url');

test('ChatGPT resource aliases match the canonical MCP resource', () => {
  const expected = 'https://mcp.example.com/mcp';
  assert.equal(resourceMatches(undefined, expected), true);
  assert.equal(resourceMatches('', expected), true);
  assert.equal(resourceMatches('https://mcp.example.com/mcp/', expected), true);
  assert.equal(resourceMatches('https://mcp.example.com', expected), true);
  assert.equal(resourceMatches('https://other.example/mcp', expected), false);
  assert.equal(resolvedResource('https://mcp.example.com', expected), expected);
  assert.throws(() => resolvedResource('https://evil.example/mcp', expected), /resource/);
});

test('authorization and token exchange accept omitted or origin-only resource', () => {
  const db = AevraDatabase.open(':memory:');
  const service = new AevraOAuthService(new OAuthRepository(db.raw()), {
    issuer: 'https://mcp.example.com',
    resource: 'https://mcp.example.com/mcp',
  });
  const client = service.registerClient({
    client_name: 'ChatGPT',
    redirect_uris: ['https://chatgpt.com/connector_platform_oauth_redirect'],
    token_endpoint_auth_method: 'none',
  });
  const pending = service.beginAuthorization({
    client_id: client.client_id,
    redirect_uri: client.redirect_uris[0]!,
    response_type: 'code',
    scope: 'mcp offline_access',
    code_challenge: challenge,
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
  });
  assert.ok(tokens.access_token);
  const refreshed = service.exchangeRefreshToken({
    grant_type: 'refresh_token',
    client_id: client.client_id,
    refresh_token: tokens.refresh_token!,
    resource: 'https://mcp.example.com',
  });
  assert.ok(refreshed.access_token);
  db.close();
});
