import assert from 'node:assert/strict';
import test from 'node:test';
import { AevraDatabase } from '../src/database.js';
import { migrations } from '../src/migrations.js';

test('013 is the newest migration and the version sequence has no gap', () => {
  const last = migrations.at(-1);
  assert.equal(last?.version, 13);
  assert.equal(last?.name, '013_mcp_upstream_pending_catalog');
  assert.deepEqual(
    migrations.map((migration) => migration.version),
    migrations.map((_, index) => index + 1),
  );
});

test('the mcp_upstreams table carries every column the registry stores', () => {
  const db = AevraDatabase.open(':memory:');
  try {
    assert.equal(db.tableNames().includes('mcp_upstreams'), true);
    const columns = db.tableColumns('mcp_upstreams');
    for (const column of [
      'id',
      'name',
      'transport',
      'config_json',
      'auth_json',
      'risk',
      'enabled',
      'catalog_fingerprint',
      'catalog_json',
      'pending_catalog_json',
      'pending_catalog_diff_json',
      'state',
      'created_at',
      'updated_at',
    ]) {
      assert.equal(columns.includes(column), true, `missing column ${column}`);
    }
  } finally {
    db.close();
  }
});

test('no column invites a credential value into the row', () => {
  const db = AevraDatabase.open(':memory:');
  try {
    const columns = db.tableColumns('mcp_upstreams');
    for (const forbidden of ['token', 'secret', 'password', 'header_value', 'value']) {
      assert.equal(columns.includes(forbidden), false, `${forbidden} must not exist`);
    }
  } finally {
    db.close();
  }
});

test('two servers cannot claim one name', () => {
  const db = AevraDatabase.open(':memory:');
  try {
    const insert = db
      .raw()
      .prepare(
        'INSERT INTO mcp_upstreams(id,name,transport,config_json,risk,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
      );
    insert.run('mu_1', 'github', 'http', '{"url":"https://a.test/mcp"}', 'HIGH', 't0', 't0');
    assert.throws(
      () =>
        insert.run('mu_2', 'github', 'http', '{"url":"https://b.test/mcp"}', 'HIGH', 't0', 't0'),
      /UNIQUE/,
    );
  } finally {
    db.close();
  }
});

test('a fresh row defaults to enabled and active with no fingerprint', () => {
  const db = AevraDatabase.open(':memory:');
  try {
    db.raw()
      .prepare(
        'INSERT INTO mcp_upstreams(id,name,transport,config_json,risk,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
      )
      .run('mu_1', 'github', 'http', '{"url":"https://a.test/mcp"}', 'HIGH', 't0', 't0');
    const row = db
      .raw()
      .prepare(
        'SELECT enabled,state,auth_json,catalog_fingerprint,catalog_json,pending_catalog_diff_json FROM mcp_upstreams WHERE id=?',
      )
      .get('mu_1') as Record<string, unknown>;
    assert.equal(row.enabled, 1);
    assert.equal(row.state, 'active');
    assert.equal(row.auth_json, '{}');
    assert.equal(row.catalog_fingerprint, null);
    assert.equal(row.catalog_json, null);
    assert.equal(row.pending_catalog_diff_json, null);
  } finally {
    db.close();
  }
});
