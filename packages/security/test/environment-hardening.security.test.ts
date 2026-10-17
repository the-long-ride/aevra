import assert from 'node:assert/strict';
import test from 'node:test';
import { buildChildEnvironment } from '../src/environment.js';
import { sanitizeStructuredSecrets } from '../src/dlp.js';
import { normalizeLogicalPath } from '../src/logical-path.js';

test('caller environment cannot inject loaders or interpreter startup hooks', () => {
  for (const key of [
    'NODE_OPTIONS',
    'LD_PRELOAD',
    'DYLD_LIBRARY_PATH',
    'PYTHONPATH',
    'BASH_ENV',
    'ENV',
    'GIT_SSH_COMMAND',
    'GIT_CONFIG_COUNT',
    'COMSPEC',
    'node_options',
  ]) {
    assert.throws(
      () => buildChildEnvironment({ [key]: 'ordinary words' }, {}, 'win32'),
      (e: any) => e.code === 'INVALID_REQUEST',
      key,
    );
  }
  assert.deepEqual(buildChildEnvironment({ PROJECT_MODE: 'ordinary words' }, {}, 'linux'), {
    PROJECT_MODE: 'ordinary words',
  });
});

test('approval preview preserves ordinary environment values and masks credential fields', () => {
  const preview: any = sanitizeStructuredSecrets(
    {
      env: { PROJECT_MODE: 'ordinary words', PASSWORD: 'private words' },
    },
    { exposeOrdinaryEnvironment: true },
  );
  assert.equal(preview.env.PROJECT_MODE, 'ordinary words');
  assert.equal(preview.env.PASSWORD, '[REDACTED]');
});

test(
  'Windows ambiguous path segments are refused before sensitivity matching',
  { skip: process.platform !== 'win32' },
  () => {
    for (const value of ['/.env ', '/.env.', '/.env::$DATA', '/folder /file.txt']) {
      assert.throws(
        () => normalizeLogicalPath(value),
        (e: any) => e.code === 'INVALID_REQUEST',
        value,
      );
    }
    assert.equal(normalizeLogicalPath('/ordinary/file.txt'), '/ordinary/file.txt');
  },
);
