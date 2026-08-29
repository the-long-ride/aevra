import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { AevraDatabase } from '../../../packages/store/src/database.js';
import { OAuthRepository } from '../../../packages/store/src/oauth.js';
import { AevraOAuthService } from '../src/auth/oauth.js';

// Sentinel verifier: if PKCE working state ever reaches durable storage, this
// literal is what the dump assertions below will find.
const VERIFIER = 'TEST_PKCE_VERIFIER_MUST_NOT_PERSIST_abcdefghijklmnopqrstuvwxyz0123456789';

const b64url = (value: Buffer) => value.toString('base64url');
const challenge = (verifier: string) => b64url(createHash('sha256').update(verifier).digest());

function fixture() {
  const now = Date.parse('2026-08-29T12:00:00.000Z');
  const db = AevraDatabase.open(':memory:');
  const repo = new OAuthRepository(db.raw(), () => new Date(now));
  const service = new AevraOAuthService(repo, {
    issuer: 'https://mcp.example.com',
    resource: 'https://mcp.example.com/mcp',
    now: () => new Date(now),
  });
  return { db, repo, service };
}

/** Serializes every row of every table so secrets can be searched for by value. */
function dumpDatabase(db: AevraDatabase) {
  const raw = db.raw();
  const tables = raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{
    name: string;
  }>;
  const dump: Record<string, unknown[]> = {};
  for (const { name } of tables) dump[name] = raw.prepare(`SELECT * FROM "${name}"`).all();
  return JSON.stringify(dump);
}

function authorize(service: AevraOAuthService) {
  const client = service.registerClient({
    client_name: 'ChatGPT',
    redirect_uris: ['https://chatgpt.com/oauth/callback'],
    token_endpoint_auth_method: 'none',
  });
  const pending = service.beginAuthorization(
    {
      client_id: client.client_id,
      redirect_uri: client.redirect_uris[0]!,
      response_type: 'code',
      scope: 'mcp offline_access',
      resource: 'https://mcp.example.com/mcp',
      code_challenge: challenge(VERIFIER),
      code_challenge_method: 'S256',
    },
    '203.0.113.4',
  );
  service.approveAuthorization(pending.id);
  const { code } = service.continueAuthorization(pending.id);
  const issued = service.exchangeAuthorizationCode({
    grant_type: 'authorization_code',
    client_id: client.client_id,
    code,
    redirect_uri: client.redirect_uris[0]!,
    code_verifier: VERIFIER,
    resource: 'https://mcp.example.com/mcp',
  });
  return { client, code, issued };
}

function assertAbsent(persisted: string, entries: Array<[string, string]>) {
  for (const [label, value] of entries) {
    assert.ok(value, `${label} should have been issued by the fixture`);
    assert.equal(
      persisted.includes(value),
      false,
      `${label} must never be written to durable storage in plaintext`,
    );
  }
}

test('completing an OAuth authorization persists no plaintext secrets', () => {
  const { db, service } = fixture();
  const { code, issued } = authorize(service);

  assertAbsent(dumpDatabase(db), [
    ['access token', issued.access_token],
    ['refresh token', issued.refresh_token!],
    ['PKCE verifier', VERIFIER],
    ['authorization code', code],
  ]);
  db.close();
});

test('rotating a refresh token persists no plaintext secrets', () => {
  const { db, service } = fixture();
  const { client, issued } = authorize(service);

  const rotated = service.exchangeRefreshToken({
    grant_type: 'refresh_token',
    client_id: client.client_id,
    refresh_token: issued.refresh_token!,
    resource: 'https://mcp.example.com/mcp',
  });

  assertAbsent(dumpDatabase(db), [
    ['rotated access token', rotated.access_token],
    ['rotated refresh token', rotated.refresh_token!],
    ['superseded access token', issued.access_token],
    ['superseded refresh token', issued.refresh_token!],
  ]);
  db.close();
});

test('issued tokens remain verifiable even though only hashes are stored', () => {
  const { db, service } = fixture();
  const { issued } = authorize(service);

  // Guards the inverse risk: proving secrets are absent is worthless if the
  // store also stopped being able to authenticate them.
  const identity = service.verifyAccessToken(issued.access_token);
  assert.equal(identity.actor, 'oauth:ChatGPT');
  assert.equal(identity.audience, 'https://mcp.example.com/mcp');
  db.close();
});
