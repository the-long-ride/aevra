import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AevraDatabase } from '../src/database.js';
import { HostControlGrantRepository } from '../src/host-control-grants.js';

test('host grants persist independently for exact connection identities', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'aevra-host-grants-'));
  const file = path.join(dir, 'aevra.db');
  const first = { kind: 'oauth' as const, key: 'oauth-one' };
  const second = { kind: 'oauth' as const, key: 'oauth-two' };
  try {
    const db = AevraDatabase.open(file);
    const grants = new HostControlGrantRepository(db.raw());
    grants.upsert(first, 'browser.control', 'admin');
    assert.equal(grants.get(first, 'browser.control')?.revokedAt, null);
    assert.equal(grants.get(second, 'browser.control'), null);
    assert.equal(grants.get(first, 'desktop.control'), null);
    db.close();

    const reopened = AevraDatabase.open(file);
    const persisted = new HostControlGrantRepository(reopened.raw());
    assert.equal(persisted.get(first, 'browser.control')?.revokedAt, null);
    assert.equal(persisted.revoke(first, 'browser.control'), true);
    assert.notEqual(persisted.get(first, 'browser.control')?.revokedAt, null);
    reopened.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('session grant is memory-only and connector uses its own key', () => {
  const db = AevraDatabase.open(':memory:');
  const grants = new HostControlGrantRepository(db.raw());
  const session = { kind: 'session' as const, key: 'ses-one' };
  const connector = { kind: 'connector' as const, key: 'connector-one' };
  grants.upsert(session, 'desktop.control', 'admin');
  grants.upsert(connector, 'browser.control', 'admin');
  assert.equal(grants.get(session, 'desktop.control')?.revokedAt, null);
  assert.equal(grants.get(connector, 'browser.control')?.revokedAt, null);
  assert.equal(grants.get({ kind: 'connector', key: 'connector-two' }, 'browser.control'), null);
  assert.equal(new HostControlGrantRepository(db.raw()).get(session, 'desktop.control'), null);
  db.close();
});
