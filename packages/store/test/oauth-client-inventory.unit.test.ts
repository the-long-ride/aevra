import assert from 'node:assert/strict';
import test from 'node:test';
import { AevraDatabase } from '../src/database.js';
import { OAuthRepository } from '../src/oauth.js';

test('configured OAuth clients can be listed before any session exists', () => {
  const db = AevraDatabase.open(':memory:');
  const repo = new OAuthRepository(db.raw(), () => new Date('2026-08-18T00:00:00.000Z'));
  repo.registerClient({
    clientName: 'ChatGPT',
    redirectUris: ['https://chatgpt.com/oauth/callback'],
  });
  repo.registerClient({ clientName: 'Claude', redirectUris: ['https://claude.ai/oauth/callback'] });
  const clients = repo.listClients();
  assert.deepEqual(
    clients.map((client) => client.clientName),
    ['ChatGPT', 'Claude'],
  );
  assert.ok(clients.every((client) => client.createdAt === '2026-08-18T00:00:00.000Z'));
  db.close();
});
