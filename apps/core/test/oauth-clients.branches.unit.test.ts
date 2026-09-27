import assert from 'node:assert/strict';
import test from 'node:test';
import { listOAuthClients, registerOAuthClient } from '../src/auth/oauth-clients.js';

function repo(existing = 0) {
  const registered: any[] = [];
  return {
    registered,
    listClients: () =>
      Array.from({ length: existing }, (_, index) => ({
        clientId: `c${index}`,
        clientName: `Client ${index}`,
        redirectUris: ['https://app/cb'],
        createdAt: '2026-01-01T00:00:00.000Z',
      })),
    registerClient: (input: any) => {
      registered.push(input);
      return {
        clientId: 'new',
        clientName: input.clientName,
        redirectUris: input.redirectUris,
        tokenEndpointAuthMethod: 'none',
        grantTypes: ['authorization_code'],
        responseTypes: ['code'],
        createdAt: '2026-01-01T00:00:10.000Z',
      };
    },
  } as any;
}

const uris = ['https://app/cb'];

test('registration rejects missing, unsupported and excessive metadata', () => {
  const cases: Array<[any, RegExp]> = [
    [{}, /at least one URI/],
    [{ redirect_uris: 'https://app/cb' }, /at least one URI/],
    [{ redirect_uris: [] }, /at least one URI/],
    [
      { redirect_uris: uris, token_endpoint_auth_method: 'client_secret_basic' },
      /public OAuth clients/,
    ],
    [{ redirect_uris: uris, application_type: 'desktop' }, /native or web/],
    [{ redirect_uris: uris, grant_types: ['authorization_code', 'implicit'] }, /grant type/],
    [{ redirect_uris: uris, response_types: ['token'] }, /response type/],
  ];
  for (const [input, pattern] of cases)
    assert.throws(() => registerOAuthClient(repo(), input), pattern);
  assert.throws(() => registerOAuthClient(repo(50), { redirect_uris: uris }), /too_many_clients/);
});

test('registration normalizes name, dedupes URIs and echoes the application type', () => {
  const store = repo();
  const client = registerOAuthClient(store, {
    client_name: '  \u0007  ',
    redirect_uris: ['https://app/cb', 'https://app/cb', 'http://localhost:9/cb'],
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    application_type: 'native',
  });
  assert.equal(client.client_name, 'MCP client');
  assert.equal(client.application_type, 'native');
  assert.equal(client.client_id_issued_at, Date.parse('2026-01-01T00:00:10.000Z') / 1000);
  assert.deepEqual(store.registered[0].redirectUris, ['https://app/cb', 'http://localhost:9/cb']);

  const unnamed = registerOAuthClient(store, {
    redirect_uris: uris,
    application_type: null as any,
  });
  assert.equal(unnamed.client_name, 'MCP client');
  assert.equal('application_type' in unnamed, false);
  const long = registerOAuthClient(store, { redirect_uris: uris, client_name: 'n'.repeat(120) });
  assert.equal(long.client_name.length, 80);
});

test('client listing exposes the oauth actor and copies redirect URIs', () => {
  const store = repo(1);
  const [row] = listOAuthClients(store);
  assert.deepEqual(row, {
    clientId: 'c0',
    clientName: 'Client 0',
    actor: 'oauth:Client 0',
    redirectUris: ['https://app/cb'],
    createdAt: '2026-01-01T00:00:00.000Z',
  });
});
