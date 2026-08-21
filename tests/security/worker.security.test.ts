import assert from 'node:assert/strict';
import test from 'node:test';
import { loadCoreConfig } from '../../apps/core/src/config.js';
import { redactText } from '../../packages/security/src/dlp.js';

test('Worker IPC is OS-local named pipe or Unix socket, never TCP', () => {
  const p = loadCoreConfig({
    AEVRA_STATE_DIR: '/tmp/aevra-sec',
    AEVRA_USERNAME: 'admin',
    AEVRA_PASSWORD: 'secret',
  }).workerSocketPath;
  assert.equal(/^https?:|^tcp:/i.test(p), false);
  assert.ok(
    process.platform === 'win32' ? p.startsWith('\\\\.\\pipe\\') : p.endsWith('worker.sock'),
  );
});

test('known injected secret is removed before remote output', () => {
  const secret = 'super-secret-token-123456789';
  const r = redactText(`output ${secret}`, [secret]);
  assert.equal(r.text.includes(secret), false);
  assert.ok(r.redactionCount > 0);
});
