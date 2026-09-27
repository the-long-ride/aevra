import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { loadCoreConfig, workerSocketPathForPlatform } from '../src/config.js';

const env = (extra: Record<string, string> = {}) => ({ AEVRA_USERNAME: 'operator', AEVRA_PASSWORD: 'sample value', AEVRA_STATE_DIR: 'state-dir', ...extra });

test('ports reject out-of-range and non-integer values', () => {
  for (const value of ['0', '65536', '1.5', 'text']) {
    assert.throws(() => loadCoreConfig(env({ AEVRA_ADMIN_PORT: value })), /AEVRA_ADMIN_PORT must be 1..65535/);
  }
  const config = loadCoreConfig(env({ AEVRA_PUBLIC_PORT: '1', AEVRA_MCP_PORT: '65535' }));
  assert.equal(config.publicPort, 1);
  assert.equal(config.mcpPort, 65535);
  assert.equal(config.adminPort, 47831);
});

test('TLS paths resolve together, CA is optional, and a lone path is rejected', () => {
  const config = loadCoreConfig(env({ AEVRA_TLS_CERT: 'cert.pem', AEVRA_TLS_KEY: 'tls-file.pem', AEVRA_TLS_CA: 'ca.pem' }));
  assert.equal(config.tlsCertPath, path.resolve('cert.pem'));
  assert.equal(config.tlsKeyPath, path.resolve('tls-file.pem'));
  assert.equal(config.tlsCaPath, path.resolve('ca.pem'));
  assert.equal(loadCoreConfig(env()).tlsCaPath, undefined);
  assert.throws(() => loadCoreConfig(env({ AEVRA_TLS_CERT: 'cert.pem' })), /must be set together/);
  assert.throws(() => loadCoreConfig(env({ AEVRA_TLS_KEY: 'tls-file.pem' })), /must be set together/);
});

test('state dir defaults come from the platform environment', () => {
  const withoutState = { AEVRA_USERNAME: 'operator', AEVRA_PASSWORD: 'sample value', LOCALAPPDATA: 'local-app', XDG_STATE_HOME: 'xdg-state' };
  const config = loadCoreConfig(withoutState);
  if (process.platform === 'win32') assert.equal(config.stateDir, path.join('local-app', 'Aevra'));
  else if (process.platform === 'linux') assert.equal(config.stateDir, path.join('xdg-state', 'aevra'));
  assert.equal(config.databasePath, path.join(config.stateDir, 'aevra.db'));
  assert.equal(workerSocketPathForPlatform('dir', 'linux', 1), path.join('dir', 'worker.sock'));
  assert.equal(workerSocketPathForPlatform('dir', 'win32', 7), '\\\\.\\pipe\\aevra-worker-7');
});
