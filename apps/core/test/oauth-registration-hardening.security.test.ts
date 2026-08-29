import assert from 'node:assert/strict';
import test from 'node:test';
import { AevraDatabase } from '../../../packages/store/src/database.js';
import { OAuthRepository } from '../../../packages/store/src/oauth.js';
import { AevraOAuthService } from '../src/auth/oauth.js';

function make() {
  const db = AevraDatabase.open(':memory:');
  const service = new AevraOAuthService(new OAuthRepository(db.raw()), {
    issuer: 'https://aevra.test',
    resource: 'https://aevra.test/mcp',
  });
  return { db, service };
}

test('client_name is stripped of control characters and capped in length', () => {
  const { db, service } = make();
  const registered = service.registerClient({
    client_name: `Aevra‮System${'x'.repeat(200)}`,
    redirect_uris: ['https://client.test/cb'],
  });
  assert.equal(/[\p{Cc}\p{Cf}]/u.test(registered.client_name), false);
  assert.ok(
    registered.client_name.length <= 80,
    `expected <= 80 chars, saw ${registered.client_name.length}`,
  );
  db.close();
});

test('a blank client_name falls back to a safe default', () => {
  const { db, service } = make();
  const registered = service.registerClient({
    client_name: '‮​',
    redirect_uris: ['https://client.test/cb'],
  });
  assert.equal(registered.client_name, 'MCP client');
  db.close();
});

test('unauthenticated registration is bounded', () => {
  const { db, service } = make();
  for (let index = 0; index < 50; index++) {
    service.registerClient({
      client_name: `client-${index}`,
      redirect_uris: [`https://client.test/${index}`],
    });
  }
  assert.throws(
    () =>
      service.registerClient({
        client_name: 'overflow',
        redirect_uris: ['https://client.test/overflow'],
      }),
    /too_many_clients/,
  );
  db.close();
});
