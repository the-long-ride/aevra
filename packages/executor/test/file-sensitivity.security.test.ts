import assert from 'node:assert/strict';
import test from 'node:test';
import { linkSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Capability } from '../../protocol/src/index.js';
import { fileCreate, fileDelete, fileMove, fileRead, fileSearch, fileWrite } from '../src/files.js';

const EXPECTED_MAX_FULL_FILE_BYTES = 16 * 1024 * 1024;

// fileRead returns a union across full/ranged reads; these tests only inspect
// the ranged variant, which always carries offset/length/totalLength.
type RangedFileRead = Awaited<ReturnType<typeof fileRead>> & {
  offset: number;
  length: number;
  totalLength: number;
};
const asRanged = (read: Awaited<ReturnType<typeof fileRead>>): RangedFileRead =>
  read as RangedFileRead;

function fixture(capabilities: Capability[] = ['files.read', 'files.search']) {
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
  assert.equal(
    hits.some((hit) => hit.path.endsWith('/.env')),
    false,
  );
  assert.equal(
    hits.some((hit) => hit.text.includes('needle-secret-value')),
    false,
  );
  assert.equal(
    hits.some((hit) => hit.path.endsWith('/normal.txt')),
    true,
  );
});

test('file_search masks SENSITIVE matching lines before return', async () => {
  const { root, roots } = fixture();
  writeFileSync(
    path.join(root, '.npmrc'),
    '//registry.npmjs.org/:_authToken=raw-sensitive-value\n',
  );

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

test(
  'Executor rejects a normal-looking symlink that resolves to a SECRET file',
  { skip: process.platform === 'win32' },
  async () => {
    const { root, roots } = fixture();
    writeFileSync(path.join(root, '.env'), 'TOKEN=secret-through-symlink\n');
    symlinkSync('.env', path.join(root, 'alias.txt'));
    await assert.rejects(() => fileRead('/alias.txt', roots), /secret|protected/i);
  },
);

test('Executor rejects hard-link aliases when another in-workspace alias is SECRET', async () => {
  const { root, roots } = fixture(['files.read', 'files.search', 'files.write', 'files.delete']);
  writeFileSync(path.join(root, '.env'), 'TOKEN=hardlink-secret-marker\n');
  linkSync(path.join(root, '.env'), path.join(root, 'alias.txt'));

  await assert.rejects(() => fileRead('/alias.txt', roots), /hard.?link|secret|protected/i);
  await assert.rejects(() => fileWrite('/alias.txt', 'TOKEN=changed', roots), /secret|protected/i);
  await assert.rejects(() => fileDelete('/alias.txt', false, roots), /secret|protected/i);
  await assert.rejects(() => fileMove('/alias.txt', '/moved.txt', roots), /secret|protected/i);
  const hits = await fileSearch('/', 'hardlink-secret-marker', roots);
  assert.equal(hits.length, 0);
});

test('normal hard-linked files remain readable and searchable', async () => {
  const { root, roots } = fixture();
  writeFileSync(path.join(root, 'source.txt'), 'normal-hardlink-marker\n');
  linkSync(path.join(root, 'source.txt'), path.join(root, 'alias.txt'));

  const read = await fileRead('/alias.txt', roots);
  assert.match(read.content, /normal-hardlink-marker/);
  const hits = await fileSearch('/', 'normal-hardlink-marker', roots);
  assert.ok(hits.some((hit) => hit.path.endsWith('/source.txt')));
  assert.ok(hits.some((hit) => hit.path.endsWith('/alias.txt')));
});

test('Executor rejects direct SECRET mutations even if Core is bypassed', async () => {
  const { root, roots } = fixture(['files.read', 'files.search', 'files.write', 'files.delete']);
  writeFileSync(path.join(root, '.env'), 'TOKEN=secret-value\n');
  writeFileSync(path.join(root, 'normal.txt'), 'normal\n');

  await assert.rejects(() => fileWrite('/.env', 'TOKEN=changed', roots), /secret|protected/i);
  await assert.rejects(() => fileCreate('/.env.local', 'TOKEN=new', roots), /secret|protected/i);
  await assert.rejects(() => fileDelete('/.env', false, roots), /secret|protected/i);
  await assert.rejects(() => fileMove('/.env', '/renamed.env', roots), /secret|protected/i);
  await assert.rejects(
    () => fileMove('/normal.txt', '/.env.production', roots),
    /secret|protected/i,
  );
});

test('fileRead range reads only the requested chunk and reports total length', async () => {
  const { root, roots } = fixture();
  writeFileSync(path.join(root, 'large.txt'), '0123456789'.repeat(200_000));

  const value = asRanged(await fileRead('/large.txt', roots, { offset: 100, length: 32 }));
  assert.equal(value.offset, 100);
  assert.equal(value.length, 32);
  assert.equal(value.content.length, 32);
  assert.equal(value.totalLength, 2_000_000);
});

test('ranged read preserves existing JS string offset semantics for multibyte UTF-8', async () => {
  const { root, roots } = fixture();
  writeFileSync(path.join(root, 'unicode.txt'), 'aéb');

  const value = asRanged(await fileRead('/unicode.txt', roots, { offset: 1, length: 1 }));
  assert.equal(value.content, 'é');
  assert.equal(value.offset, 1);
  assert.equal(value.length, 1);
  assert.equal(value.totalLength, 3);
});

test('full reads above the explicit safety limit require ranged access', async () => {
  const { root, roots } = fixture();
  writeFileSync(
    path.join(root, 'too-large.txt'),
    Buffer.alloc(EXPECTED_MAX_FULL_FILE_BYTES + 1, 0x61),
  );
  await assert.rejects(() => fileRead('/too-large.txt', roots), /full-read limit|offset\/length/i);
});
