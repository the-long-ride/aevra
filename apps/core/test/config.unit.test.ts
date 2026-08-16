import assert from 'node:assert/strict';
import test from 'node:test';
import { loadCoreConfig } from '../src/config.js';

test('config is split loopback listeners', () => {
  const c = loadCoreConfig({
    AEVRA_STATE_DIR: '/tmp/aevra-state',
    AEVRA_USERNAME: 'admin',
    AEVRA_PASSWORD: 'secret',
  });
  assert.equal(c.publicHost, '127.0.0.1');
  assert.equal(c.publicPort, 47830);
  assert.equal(c.adminHost, '127.0.0.1');
  assert.equal(c.adminPort, 47831);
  assert.equal(c.mcpHost, '127.0.0.1');
  assert.equal(c.mcpPort, 47832);
  assert.equal(c.leaseIdleMs, 30 * 60_000);
  assert.notEqual(c.publicPort, c.adminPort);
  assert.notEqual(c.publicPort, c.mcpPort);
  assert.notEqual(c.adminPort, c.mcpPort);
});

test('public gateway port can be overridden without widening its default bind', () => {
  const c = loadCoreConfig({
    AEVRA_STATE_DIR: '/tmp/aevra-state',
    AEVRA_USERNAME: 'admin',
    AEVRA_PASSWORD: 'secret',
    AEVRA_PUBLIC_PORT: '49000',
  });
  assert.equal(c.publicHost, '127.0.0.1');
  assert.equal(c.publicPort, 49000);
});

test('state dir names are Aevra', () => {
  const c = loadCoreConfig({
    AEVRA_STATE_DIR: '/tmp/aevra-state',
    AEVRA_USERNAME: 'admin',
    AEVRA_PASSWORD: 'secret',
  });
  assert.ok(c.stateDir.endsWith('aevra-state'));
  assert.ok(c.databasePath.endsWith('aevra.db'));
});

test('config rejects startup without mandatory admin credentials', () => {
  assert.throws(
    () => loadCoreConfig({ AEVRA_STATE_DIR: '/tmp/aevra-state' }),
    /ADMIN_CREDENTIALS_REQUIRED/,
  );
});
