import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { nativeMultiSearch, nodeCandidates } from '../src/native-search.js';

test('native multi-search runs values together and returns safe hits', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aevra-search-'));
  try {
    await writeFile(path.join(root, 'alpha.ts'), 'const alpha = 1;\nconst beta = 2;\n');
    await writeFile(path.join(root, 'notes.md'), 'beta value\n');
    const roots = [
      {
        id: 'root',
        kind: 'workspace' as const,
        logicalPrefix: '/',
        hostRoot: root,
        capabilities: ['files.search' as const],
      },
    ];
    const result = await nativeMultiSearch(
      [
        { value: 'alpha', mode: 'text', path: '/' },
        { value: '.md', mode: 'files', path: '/' },
      ],
      roots,
      10,
    );
    assert.equal(result.results.length, 2);
    assert.equal(result.results[0]?.hits[0]?.path, '/alpha.ts', JSON.stringify(result.results[0]));
    assert.equal(result.results[0]?.hits[0]?.line, 1);
    assert.equal(result.results[1]?.hits[0]?.path, '/notes.md', JSON.stringify(result.results[1]));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('node fallback backend scans bounded, skips .git, and matches every mode', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aevra-nodesearch-'));
  try {
    await mkdir(path.join(root, '.git'), { recursive: true });
    await writeFile(path.join(root, '.git', 'hidden.ts'), 'const needle = 1;\n');
    await writeFile(path.join(root, 'code.ts'), 'const needle = 2;\nsecond line\n');
    await writeFile(path.join(root, 'readme.md'), 'needle appears here\n');
    await writeFile(path.join(root, 'blob.bin'), 'text\0binary needle\n');

    const text = await nodeCandidates({ value: 'needle', mode: 'text', path: '/' }, root);
    assert.equal(text.backend, 'node');
    assert.deepEqual(
      text.candidates.map((candidate) => path.basename(candidate.path)),
      ['code.ts', 'readme.md'],
    );
    assert.equal(text.candidates[0]?.line, 1);

    const regex = await nodeCandidates({ value: 'ne{2}d', mode: 'regex', path: '/' }, root);
    assert.equal(regex.candidates.length, 2);

    const invalid = await nodeCandidates({ value: '[unclosed', mode: 'regex', path: '/' }, root);
    assert.deepEqual(invalid.candidates, []);

    const files = await nodeCandidates({ value: '.md', mode: 'files', path: '/' }, root);
    assert.deepEqual(
      files.candidates.map((candidate) => path.basename(candidate.path)),
      ['readme.md'],
    );

    // Test error handling in oneSearch (e.g. non-existent path or failed resolution)
    const roots = [
      {
        id: 'root',
        kind: 'workspace' as const,
        logicalPrefix: '/',
        hostRoot: root,
        capabilities: ['files.search' as const],
      },
    ];
    const regexMulti = await nativeMultiSearch(
      [{ value: 'ne[e]dle', mode: 'regex', path: '/' }],
      roots,
      10,
    );
    assert.ok(regexMulti.results.length > 0);

    // Non-existent path search rejects because path does not resolve
    await assert.rejects(() =>
      nativeMultiSearch([{ value: 'x', mode: 'text', path: '/missing_dir_123' }], roots, 1),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
