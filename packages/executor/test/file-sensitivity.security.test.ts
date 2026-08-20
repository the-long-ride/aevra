import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  fileCreate,
  fileDelete,
  fileMove,
  fileRead,
  fileSearch,
  fileWrite,
} from '../src/files.js';

const EXPECTED_MAX_FULL_FILE_BYTES = 16 * 1024 * 1024;

function fixture(capabilities = ['files.read', 'files.search'] as const) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'aevra-sensitive-files-'));
  const roots = [
    {
      id: 'workspace',
      kind: 'workspace' as const,
      logicalPrefix: '/',
      hostRoot: root,
      capabilities: [...capabilities],
    },
  ];
  return { root, roots };
}

test('file_search contributes zero hits from SECRET files', async () => {
  const { root, roots } = fixture();
  writeFileSync(path.join(root, '.env'), 'AEVRA_UNIQUE_SECRET=needle-secret-value\n');
  writeFileSync(path.join(root, 'normal.txt'), 'needle public value\n');

  const hits = await fileSearch('/', 'needle', roots);
  assert.equal(hits.some((hit) => hit.path.endsWith('/.env')), false);
  assert.equal(hits.some((hit) => hit.text.includes('needle-secret-value')), false);
  assert.equal(hits.some((hit) => hit.path.endsWith('/normal.txt')), true);
});

test('file_search masks SENSITIVE matching lines before return', async () => {
  const { root, roots } = fixture();
  writeFileSync(path.join(root, '.npmrc'), '//registry.npmjs.org/:_authToken=raw-sensitive-value\n');

  const hits = await fileSearch('/', '_authToken', roots);
  assert.equal(hits.length, 1);
  assert.match(hits[0]!.text, /_authToken/);
  assert.match(hits[0]!.text, /\[REDACTED\]/);
  assert.equal(hits[0]!.text.includes('raw-sensitive-value'), false);
});

test('Executor rejects direct SECRET reads even if Core is bypassed', async () => {
  const { root, roots } = fixture();
  writeFileSync(path.join(root, '.env'), 'TOKEN=secret-value\n');
  await assert.rejects(() => fileRead('/.env', roots), /secret|protected/i);
});

test('Executor rejects direct SECRET mutations even if Core is bypassed', async () => {
  const { root, roots } = fixture([
    'files.read',
    'files.search',
    'files.write',
    'files.delete',
  ] as const);
  writeFileSync(path.join(root, '.env'), 'TOKEN=secret-value\n');
  writeFileSync(path.join(root, 'normal.txt'), 'normal\n');

  await assert.rejects(() => fileWrite('/.env', 'TOKEN=changed', roots), /secret|protected/i);
  await assert.rejects(() => fileCreate('/.env.local', 'TOKEN=new', roots), /secret|protected/i);
  await assert.rejects(() => fileDelete('/.env', false, roots), /secret|protected/i);
  await assert.rejects(() => fileMove('/.env', '/renamed.env', roots), /secret|protected/i);
  await assert.rejects(() => fileMove('/normal.txt', '/.env.production', roots), /secret|protected/i);
});

test('fileRead range reads only the requested chunk and reports total length', async () => {
  const { root, roots } = fixture();
  writeFileSync(path.join(root, 'large.txt'), '0123456789'.repeat(200_000));

  const value = await fileRead('/large.txt', roots, { offset: 100, length: 32 });
  assert.equal(value.offset, 100);
  assert.equal(value.length, 32);
  assert.equal(value.content.length, 32);
  assert.equal(value.totalLength, 2_000_000);
});

test('full reads above the explicit safety limit require ranged access', async () => {
  const { root, roots } = fixture();
  writeFileSync(
    path.join(root, 'too-large.txt'),
    Buffer.alloc(EXPECTED_MAX_FULL_FILE_BYTES + 1, 0x61),
  );
  await assert.rejects(
    () => fileRead('/too-large.txt', roots),
    /full-read limit|offset\/length/i,
  );
});
