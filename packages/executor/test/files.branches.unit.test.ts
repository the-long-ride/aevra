import assert from 'node:assert/strict';
import { linkSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileCreate, fileList, fileRead, fileSearch, fileWrite } from '../src/files.js';

const CAPS = ['files.read', 'files.search', 'files.write', 'files.delete'] as const;

function workspace(prefix = '/') {
  const root = mkdtempSync(path.join(os.tmpdir(), 'aevra-files-br-'));
  const roots = [
    {
      id: 'w',
      kind: 'workspace' as const,
      logicalPrefix: prefix,
      hostRoot: root,
      capabilities: [...CAPS],
    },
  ];
  return { root, roots, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('hard-link index walks nested dirs, skips single-link files and unreadable roots', async () => {
  const { root, roots, cleanup } = workspace();
  try {
    mkdirSync(path.join(root, 'nested'));
    writeFileSync(path.join(root, 'nested', '.env'), 'NAME=sample value\n');
    linkSync(path.join(root, 'nested', '.env'), path.join(root, 'alias.txt'));
    writeFileSync(path.join(root, 'plain.txt'), 'plain words\n');
    symlinkSync(path.join(root, 'nested'), path.join(root, 'jn'), 'junction');
    // A second root whose host directory does not exist: its walk must be skipped silently.
    const withMissing = [
      ...roots,
      { ...roots[0]!, id: 'gone', logicalPrefix: '/gone', hostRoot: path.join(root, 'missing') },
    ];
    await assert.rejects(() => fileRead('/alias.txt', withMissing), /Protected secret resource/);
    // Unrelated single-link files are unaffected by the index walk.
    assert.equal((await fileRead('/plain.txt', withMissing)).content, 'plain words\n');
  } finally {
    cleanup();
  }
});

test('hard link whose sibling lives outside every root stays NORMAL', async () => {
  const { root, roots, cleanup } = workspace();
  const outside = mkdtempSync(path.join(os.tmpdir(), 'aevra-files-out-'));
  try {
    writeFileSync(path.join(outside, 'origin.txt'), 'shared words\n');
    linkSync(path.join(outside, 'origin.txt'), path.join(root, 'shared.txt'));
    const read = await fileRead('/shared.txt', roots);
    assert.equal(read.sensitivity, 'NORMAL');
    assert.equal(read.content, 'shared words\n');
  } finally {
    cleanup();
    rmSync(outside, { recursive: true, force: true });
  }
});

test('protected globs are applied to hard-link aliases and to direct reads', async () => {
  const { root, roots, cleanup } = workspace('/ws/');
  try {
    writeFileSync(path.join(root, 'guarded.txt'), 'guarded words\n');
    linkSync(path.join(root, 'guarded.txt'), path.join(root, 'twin.txt'));
    const globs = [{ glob: 'ws/guarded.txt', class: 'SECRET' as const }];
    await assert.rejects(() => fileRead('/ws/twin.txt', roots, undefined, globs), /secret/i);
    // A glob that matches nothing leaves the alias readable.
    const other = [{ glob: 'nothing/**', class: 'SECRET' as const }];
    assert.equal(
      (await fileRead('/ws/twin.txt', roots, undefined, other)).content,
      'guarded words\n',
    );
  } finally {
    cleanup();
  }
});

async function rangedRead(...args: Parameters<typeof fileRead>) {
  const result = await fileRead(...args);
  if (!('offset' in result)) throw new Error('expected a ranged read result');
  return result;
}

test('ranged reads default missing or invalid offset and length', async () => {
  const { root, roots, cleanup } = workspace();
  try {
    writeFileSync(path.join(root, 'r.txt'), 'abcdefghij');
    const lengthOnly = await rangedRead('/r.txt', roots, { length: 3 });
    assert.equal(lengthOnly.content, 'abc');
    assert.equal(lengthOnly.offset, 0);
    const offsetOnly = await rangedRead('/r.txt', roots, { offset: 7 });
    assert.equal(offsetOnly.content, 'hij');
    assert.equal(offsetOnly.totalLength, 10);
    const invalid = await rangedRead('/r.txt', roots, { offset: Number.NaN, length: Number.NaN });
    assert.equal(invalid.offset, 0);
    assert.equal(invalid.content, '');
    const empty = await rangedRead('/r.txt', roots, { offset: 0, length: 0 });
    assert.equal(empty.length, 0);
  } finally {
    cleanup();
  }
});

test('sensitive files are masked for both ranged and full reads', async () => {
  const { root, roots, cleanup } = workspace();
  try {
    writeFileSync(path.join(root, 'credentials'), 'name=sample value\n');
    const full = await fileRead('/credentials', roots);
    assert.equal(full.sensitivity, 'SENSITIVE');
    assert.equal(full.content, 'name=[REDACTED]\n');
    const ranged = await fileRead('/credentials', roots, { offset: 0, length: 100 });
    assert.equal(ranged.content, 'name=[REDACTED]\n');
    assert.equal(ranged.hash.startsWith('sha256:'), false);
  } finally {
    cleanup();
  }
});

test('fileList reports directory, file and link entry types', async () => {
  const { root, roots, cleanup } = workspace();
  try {
    mkdirSync(path.join(root, 'dir'));
    writeFileSync(path.join(root, 'f.txt'), 'x');
    symlinkSync(path.join(root, 'dir'), path.join(root, 'jn'), 'junction');
    const { entries } = await fileList('/', roots);
    const byName = Object.fromEntries(entries.map((entry) => [entry.name, entry.type]));
    assert.equal(byName.dir, 'directory');
    assert.equal(byName['f.txt'], 'file');
    assert.equal(byName.jn, 'link');
  } finally {
    cleanup();
  }
});

test('fileSearch honours max, skips large, secret and non-file entries', async () => {
  const { root, roots, cleanup } = workspace();
  try {
    mkdirSync(path.join(root, 'a'));
    writeFileSync(path.join(root, 'a', 'one.txt'), 'needle 1\nneedle 2\nneedle 3\n');
    writeFileSync(path.join(root, 'b.txt'), 'needle b\n');
    writeFileSync(path.join(root, 'big.txt'), 'needle '.padEnd(1024 * 1024, 'x'));
    writeFileSync(path.join(root, '.env'), 'needle=sample value\n');
    symlinkSync(path.join(root, 'a'), path.join(root, 'link'), 'junction');

    const all = await fileSearch('/', 'needle', roots, 100);
    const paths = all.hits.map((hit) => hit.path).sort();
    assert.deepEqual(paths, ['/a/one.txt', '/a/one.txt', '/a/one.txt', '/b.txt']);

    // Stops inside a file once the budget is reached.
    const two = await fileSearch('/', 'needle', roots, 2);
    assert.equal(two.hits.length, 2);
    // Stops before visiting later entries and directories once full.
    const one = await fileSearch('/a', 'needle', roots, 1);
    assert.deepEqual(one.hits, [{ path: '/a/one.txt', line: 1, text: 'needle 1' }]);
    const zero = await fileSearch('/', 'needle', roots, 0);
    assert.deepEqual(zero.hits, []);
  } finally {
    cleanup();
  }
});

test('fileSearch with a hard link builds the index once and masks sensitive lines', async () => {
  const { root, roots, cleanup } = workspace();
  try {
    writeFileSync(path.join(root, 'secrets.json'), '"name": "needle"\n');
    linkSync(path.join(root, 'secrets.json'), path.join(root, 'copy.txt'));
    const { hits } = await fileSearch('/', 'needle', roots, 10);
    assert.equal(hits.length, 2);
    for (const hit of hits) assert.equal(hit.text, '"name": "[REDACTED]"');
  } finally {
    cleanup();
  }
});

test('create and write accept base64 content', async () => {
  const { roots, cleanup } = workspace();
  try {
    const encoded = Buffer.from('decoded words', 'utf8').toString('base64');
    await fileCreate('/c.txt', encoded, roots, 'base64');
    assert.equal((await fileRead('/c.txt', roots)).content, 'decoded words');
    await fileWrite('/c.txt', Buffer.from('second', 'utf8').toString('base64'), roots, 'base64');
    assert.equal((await fileRead('/c.txt', roots)).content, 'second');
    await assert.rejects(() => fileCreate('/c.txt', 'again', roots), /EEXIST/);
  } finally {
    cleanup();
  }
});
