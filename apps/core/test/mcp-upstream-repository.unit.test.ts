import assert from 'node:assert/strict';
import test from 'node:test';
import { AevraDatabase } from '../../../packages/store/src/database.js';
import { UpstreamRepository } from '../src/mcp-upstream/upstream-repository.js';
import type { UpstreamRecord } from '../src/mcp-upstream/upstream-records.js';

function record(overrides: Partial<UpstreamRecord> = {}): UpstreamRecord {
  return {
    id: 'mu_1',
    name: 'github',
    transport: 'http',
    config: { url: 'https://a.test/mcp' },
    auth: { header: 'Authorization', secretRefId: 'sr_1' },
    risk: 'HIGH',
    enabled: true,
    catalogFingerprint: null,
    catalog: null,
    pendingCatalog: null,
    pendingCatalogDiff: null,
    state: 'active',
    createdAt: 't0',
    updatedAt: 't0',
    ...overrides,
  };
}

function repository() {
  const db = AevraDatabase.open(':memory:');
  return { db, repo: new UpstreamRepository(db.raw()) };
}

test('an inserted record reads back unchanged', () => {
  const { db, repo } = repository();
  try {
    repo.insert(record());
    assert.deepEqual(repo.get('mu_1'), record());
    assert.deepEqual(repo.findByName('github'), record());
    assert.equal(repo.get('mu_missing'), null);
    assert.equal(repo.findByName('nope'), null);
  } finally {
    db.close();
  }
});

test('list is ordered by name so the admin surface is stable', () => {
  const { db, repo } = repository();
  try {
    repo.insert(record({ id: 'mu_2', name: 'zulu' }));
    repo.insert(record({ id: 'mu_1', name: 'alpha' }));
    assert.deepEqual(
      repo.list().map((entry) => entry.name),
      ['alpha', 'zulu'],
    );
  } finally {
    db.close();
  }
});

test('update touches only the fields it was given and stamps updated_at', () => {
  const { db, repo } = repository();
  try {
    repo.insert(record());
    const next = repo.update('mu_1', { state: 'needs-review' }, 't1');
    assert.equal(next?.state, 'needs-review');
    assert.equal(next?.updatedAt, 't1');
    assert.equal(next?.risk, 'HIGH');
    assert.equal(next?.enabled, true);
    assert.deepEqual(repo.get('mu_1'), next);
  } finally {
    db.close();
  }
});

test('a fingerprint can be set and cleared back to null', () => {
  const { db, repo } = repository();
  try {
    repo.insert(record());
    assert.equal(
      repo.update('mu_1', { catalogFingerprint: 'abc123' }, 't1')?.catalogFingerprint,
      'abc123',
    );
    assert.equal(repo.update('mu_1', { catalogFingerprint: null }, 't2')?.catalogFingerprint, null);
  } finally {
    db.close();
  }
});

test('updating a row that is not there reports null rather than inventing one', () => {
  const { db, repo } = repository();
  try {
    assert.equal(repo.update('mu_missing', { enabled: false }, 't1'), null);
    assert.deepEqual(repo.list(), []);
  } finally {
    db.close();
  }
});

test('remove deletes exactly one row', () => {
  const { db, repo } = repository();
  try {
    repo.insert(record());
    repo.insert(record({ id: 'mu_2', name: 'docs' }));
    repo.remove('mu_1');
    assert.deepEqual(
      repo.list().map((entry) => entry.id),
      ['mu_2'],
    );
  } finally {
    db.close();
  }
});

test('the stored row holds a secret reference id, never a value', () => {
  const { db, repo } = repository();
  try {
    repo.insert(record());
    const row = db.raw().prepare('SELECT auth_json FROM mcp_upstreams WHERE id=?').get('mu_1') as {
      auth_json: string;
    };
    assert.equal(row.auth_json, '{"header":"Authorization","secretRefId":"sr_1"}');
  } finally {
    db.close();
  }
});
