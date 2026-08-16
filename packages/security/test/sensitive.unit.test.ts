import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifySensitivity,
  maskSecretFile,
  maskSensitiveFile,
  maxSensitivity,
} from '../src/sensitive.js';

test('secret and sensitive paths classify conservatively', () => {
  assert.equal(classifySensitivity({ path: '/.env' }), 'SECRET');
  assert.equal(classifySensitivity({ path: '/home/id_ed25519' }), 'SECRET');
  assert.equal(classifySensitivity({ path: '/src/a.ts' }), 'NORMAL');
  assert.equal(classifySensitivity({ path: '/tmp/x', gitIgnored: true }), 'SENSITIVE');
  assert.equal(maskSecretFile('.env', 'A=one\nB=two'), 'A=[REDACTED]\nB=[REDACTED]');

  assert.equal(maxSensitivity('NORMAL', 'SENSITIVE'), 'SENSITIVE');
  assert.equal(maxSensitivity('NORMAL', 'SECRET', 'SENSITIVE'), 'SECRET');

  assert.equal(classifySensitivity({ path: '/a.ts', explicit: 'SECRET' }), 'SECRET');
  assert.equal(
    classifySensitivity({
      path: '/app.log',
      userPatterns: [{ pattern: /\.log$/, class: 'SENSITIVE' }],
    }),
    'SENSITIVE',
  );
  assert.equal(
    classifySensitivity({ path: '/external/file.txt', mountPolicy: 'SECRET' }),
    'SECRET',
  );

  assert.equal(maskSecretFile('cert.pem', 'SECRET_KEY_DATA'), '[REDACTED SECRET FILE]');
  const maskedJson = maskSensitiveFile(
    'config.json',
    '{\n  "token": "secret123",\n  KEY=VAL,\n  plain_line\n}',
  );
  assert.ok(maskedJson.includes('"token": "[REDACTED]"'));
  assert.ok(maskedJson.includes('KEY=[REDACTED]'));
  assert.ok(maskedJson.includes('[REDACTED]'));
});
