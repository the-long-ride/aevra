import assert from 'node:assert/strict';
import test from 'node:test';
import { AevraDatabase } from '../src/database.js';
import { ConnectorRepository } from '../src/connectors.js';
test('create returns token once and list omits hashes', () => {
  const db = AevraDatabase.open(':memory:');
  const repo = new ConnectorRepository(db.raw());
  const { connector, token } = repo.create('Claude.ai');
  assert.match(token, /^[A-Za-z0-9_-]{22}$/);
  assert.equal(connector.name, 'Claude.ai');
  assert.equal(connector.lastUsedAt, null);
  const listed = repo.list();
  assert.equal(listed.length, 1);
  assert.deepEqual(Object.keys(listed[0]!).sort(), [
    'createdAt',
    'expiresAt',
    'id',
    'lastUsedAt',
    'name',
    'profileCap',
    'workspaceId',
  ]);
  db.close();
});
test('findByToken matches and rejects, revoke invalidates', () => {
  const db = AevraDatabase.open(':memory:');
  const repo = new ConnectorRepository(db.raw());
  const { connector, token } = repo.create('Gemini');
  assert.deepEqual(repo.findByToken(token), {
    id: connector.id,
    name: 'Gemini',
    workspaceId: null,
    profileCap: null,
    expiresAt: null,
  });
  assert.equal(repo.findByToken('wrong-token-123456789'), null);
  repo.revoke(connector.id);
  assert.equal(repo.findByToken(token), null);
  assert.equal(repo.list().length, 0);
  db.close();
});
test('recordUse throttles writes to one per minute', () => {
  const db = AevraDatabase.open(':memory:');
  const repo = new ConnectorRepository(db.raw());
  const { connector } = repo.create('ChatGPT');
  repo.recordUse(connector.id);
  repo.recordUse(connector.id);
  const [row] = repo.list();
  assert.ok(row!.lastUsedAt);
  db.close();
});

test('bindings persist and TTL expires tokens', () => {
  const db = AevraDatabase.open(':memory:');
  const repo = new ConnectorRepository(db.raw());
  const wsId = 'w1';
  const past = new Date(Date.now() - 1000).toISOString();
  const future = new Date(Date.now() + 3_600_000).toISOString();
  const expired = repo.create({ name: 'Old', expiresAt: past });
  const live = repo.create({
    name: 'Live',
    workspaceId: wsId,
    profileCap: 'read-only',
    expiresAt: future,
  });
  assert.equal(repo.findByToken(expired.token!), null);
  const found = repo.findByToken(live.token!);
  assert.equal(found!.workspaceId, wsId);
  assert.equal(found!.profileCap, 'read-only');
  assert.deepEqual(repo.getBindings(live.connector.id), {
    workspaceId: wsId,
    profileCap: 'read-only',
  });
  db.close();
});
test('rotation keeps old token valid during grace only', () => {
  const db = AevraDatabase.open(':memory:');
  const repo = new ConnectorRepository(db.raw());
  const { connector, token } = repo.create('Rotate');
  const next = repo.rotate(connector.id, 60_000)!;
  assert.equal(repo.findByToken(next)!.name, 'Rotate');
  assert.equal(repo.findByToken(token)!.name, 'Rotate', 'old token still valid in grace');
  assert.equal(repo.findByToken(token, Date.now() + 120_000), null, 'old token denied after grace');
  assert.equal(repo.rotate('missing'), null);
  db.close();
});
