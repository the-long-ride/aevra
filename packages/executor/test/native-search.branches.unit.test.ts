import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { nativeMultiSearch, nodeCandidates } from '../src/native-search.js';

const WIN = process.platform === 'win32';

// Fake native tools read their canned stdout/stderr/exit code from files next
// to them, so every backend branch runs without depending on the host's tools.
function fakeTool(dir: string, name: string, stdout: string, code: number, stderr = '') {
  writeFileSync(path.join(dir, `${name}-out.txt`), stdout);
  writeFileSync(path.join(dir, `${name}-code.txt`), String(code));
  if (stderr) writeFileSync(path.join(dir, `${name}-err.txt`), stderr);
  else rmSync(path.join(dir, `${name}-err.txt`), { force: true });
  if (WIN) {
    writeFileSync(
      path.join(dir, `${name}.cmd`),
      [
        '@echo off',
        `type "%~dp0${name}-out.txt"`,
        `if exist "%~dp0${name}-err.txt" type "%~dp0${name}-err.txt" 1>&2`,
        `set /p CODE=<"%~dp0${name}-code.txt"`,
        'exit /b %CODE%',
        '',
      ].join('\r\n'),
    );
  } else {
    const file = path.join(dir, name);
    writeFileSync(
      file,
      [
        '#!/bin/sh',
        'd=$(dirname "$0")',
        `cat "$d/${name}-out.txt"`,
        `[ -f "$d/${name}-err.txt" ] && cat "$d/${name}-err.txt" >&2`,
        `exit $(cat "$d/${name}-code.txt")`,
        '',
      ].join('\n'),
    );
    chmodSync(file, 0o755);
  }
}

function setup() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'aevra-ns-br-'));
  const bin = mkdtempSync(path.join(os.tmpdir(), 'aevra-ns-bin-'));
  writeFileSync(path.join(root, 'alpha.ts'), 'const alpha = 1;\nconst beta = 2;\n');
  writeFileSync(path.join(root, 'notes.md'), 'beta value\n');
  const roots = [
    {
      id: 'root',
      kind: 'workspace' as const,
      logicalPrefix: '/',
      hostRoot: root,
      capabilities: ['files.search' as const, 'files.read' as const],
    },
  ];
  const savedPath = process.env.PATH;
  return {
    root,
    bin,
    roots,
    usePath(value: string) {
      process.env.PATH = value;
    },
    cleanup() {
      process.env.PATH = savedPath;
      rmSync(root, { recursive: true, force: true });
      rmSync(bin, { recursive: true, force: true });
    },
  };
}

const match = (file: string, line?: number) =>
  JSON.stringify({ type: 'match', data: { path: { text: file }, line_number: line } });

test('rg JSON output: malformed, non-match, duplicate, missing and out-of-range lines', async () => {
  const env = setup();
  try {
    const lines = [
      '',
      'not json',
      JSON.stringify({ type: 'begin', data: {} }),
      match('alpha.ts'),
      match('./alpha.ts', 1),
      match('./alpha.ts', 1),
      match(path.join(env.root, 'alpha.ts'), 2),
      match('ghost.ts', 1),
      match('', 1),
      match('alpha.ts', 9),
    ];
    fakeTool(env.bin, 'rg', lines.join('\n') + '\n', 1);
    env.usePath(`${env.bin}${path.delimiter}${process.env.PATH}`);
    const { results } = await nativeMultiSearch(
      [
        { value: 'alpha', mode: 'text', path: '' },
        { value: 'al.ha', mode: 'regex', path: '/' },
      ],
      env.roots,
      10,
    );
    for (const result of results) {
      assert.equal(result.backend, 'rg');
      assert.deepEqual(result.hits, [
        { path: '/alpha.ts', line: 1, text: 'const alpha = 1;' },
        { path: '/alpha.ts', line: 2, text: 'const beta = 2;' },
        { path: '/alpha.ts', line: 9, text: '' },
      ]);
    }
    // The per-query budget stops collection early and is clamped to at least one.
    const capped = await nativeMultiSearch([{ value: 'a', mode: 'text', path: '/' }], env.roots, 0);
    assert.equal(capped.results[0]!.hits.length, 1);
  } finally {
    env.cleanup();
  }
});

test('rg failures surface as an unavailable backend with the tool message', async () => {
  const env = setup();
  try {
    env.usePath(`${env.bin}${path.delimiter}${process.env.PATH}`);
    fakeTool(env.bin, 'rg', '', 2, 'bad pattern words');
    let { results } = await nativeMultiSearch([{ value: 'x', mode: 'text', path: '/' }], env.roots);
    assert.equal(results[0]!.backend, 'unavailable');
    assert.match(String(results[0]!.error), /bad pattern words/);

    fakeTool(env.bin, 'rg', '', 2);
    ({ results } = await nativeMultiSearch([{ value: 'x', mode: 'text', path: '/' }], env.roots));
    assert.equal(results[0]!.error, 'rg exited 2');

    fakeTool(env.bin, 'rg', '', 3);
    ({ results } = await nativeMultiSearch([{ value: 'x', mode: 'files', path: '/' }], env.roots));
    assert.equal(results[0]!.error, 'rg exited 3');

    fakeTool(env.bin, 'rg', '', 3, 'files failed words');
    ({ results } = await nativeMultiSearch([{ value: 'x', mode: 'files', path: '/' }], env.roots));
    assert.match(String(results[0]!.error), /files failed words/);
  } finally {
    env.cleanup();
  }
});

test('rg files mode filters listed paths by the query value', async () => {
  const env = setup();
  try {
    env.usePath(`${env.bin}${path.delimiter}${process.env.PATH}`);
    fakeTool(env.bin, 'rg', 'alpha.ts\n\nnotes.md\nmissing.md\n', 0);
    const { results } = await nativeMultiSearch([{ value: '.md', mode: 'files', path: '/' }], env.roots);
    assert.equal(results[0]!.backend, 'rg');
    assert.deepEqual(results[0]!.hits, [{ path: '/notes.md' }]);
  } finally {
    env.cleanup();
  }
});

test('PowerShell backend parses tab-separated matches when rg is absent', { skip: !WIN }, async () => {
  const env = setup();
  try {
    env.usePath(env.bin);
    fakeTool(env.bin, 'pwsh', `${path.join(env.root, 'alpha.ts')}\t2\r\nno-line-number\r\n`, 0);
    let { results } = await nativeMultiSearch(
      [
        { value: 'beta', mode: 'text', path: '/' },
        { value: 'b.ta', mode: 'regex', path: '/' },
      ],
      env.roots,
    );
    for (const result of results) {
      assert.equal(result.backend, 'powershell');
      assert.deepEqual(result.hits, [{ path: '/alpha.ts', line: 2, text: 'const beta = 2;' }]);
    }

    fakeTool(env.bin, 'pwsh', `${path.join(env.root, 'notes.md')}\r\n${path.join(env.root, 'alpha.ts')}\r\n`, 0);
    ({ results } = await nativeMultiSearch([{ value: 'notes', mode: 'files', path: '/' }], env.roots));
    assert.deepEqual(results[0]!.hits, [{ path: '/notes.md' }]);
  } finally {
    env.cleanup();
  }
});

test('failing or missing PowerShell falls back to the node scan', { skip: !WIN }, async () => {
  const env = setup();
  try {
    env.usePath(env.bin);
    fakeTool(env.bin, 'pwsh', '', 1, 'pwsh failed words');
    let { results } = await nativeMultiSearch([{ value: 'beta', mode: 'text', path: '/' }], env.roots);
    assert.equal(results[0]!.backend, 'node');
    assert.deepEqual(
      results[0]!.hits.map((hit) => hit.path),
      ['/alpha.ts', '/notes.md'],
    );

    rmSync(path.join(env.bin, 'pwsh.cmd'));
    ({ results } = await nativeMultiSearch([{ value: 'alpha', mode: 'files', path: '/' }], env.roots));
    assert.equal(results[0]!.backend, 'node');
    assert.deepEqual(results[0]!.hits, [{ path: '/alpha.ts' }]);
  } finally {
    env.cleanup();
  }
});

test('node scan descends subdirectories, skips large files and stops at the file budget', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'aevra-ns-limit-'));
  try {
    mkdirSync(path.join(root, 'a'));
    for (let index = 0; index < 2000; index += 1) {
      writeFileSync(path.join(root, 'a', `f${String(index).padStart(4, '0')}.txt`), 'needle\n');
    }
    mkdirSync(path.join(root, 'a', 'zz'));
    writeFileSync(path.join(root, 'a', 'zz', 'late.txt'), 'needle\n');
    writeFileSync(path.join(root, 'z.txt'), 'needle\n');
    const text = await nodeCandidates({ value: 'needle', mode: 'text', path: '/' }, root);
    // 2002 files exist; both the walk and the match loop stop at the 2000 budget.
    assert.equal(text.candidates.length, 2000);
    const files = await nodeCandidates({ value: '.txt', mode: 'files', path: '/' }, root);
    assert.equal(files.candidates.length, 2000);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  const small = mkdtempSync(path.join(os.tmpdir(), 'aevra-ns-small-'));
  try {
    mkdirSync(path.join(small, 'sub'));
    writeFileSync(path.join(small, 'sub', 'deep.txt'), 'other\nneedle here\n');
    writeFileSync(path.join(small, 'huge.txt'), 'needle '.padEnd(600 * 1024, 'x'));
    const result = await nodeCandidates({ value: 'needle', mode: 'text', path: '/' }, small);
    assert.deepEqual(result.candidates, [{ path: path.join(small, 'sub', 'deep.txt'), line: 2 }]);
    const missing = await nodeCandidates(
      { value: 'needle', mode: 'text', path: '/' },
      path.join(small, 'nope'),
    );
    assert.deepEqual(missing.candidates, []);
  } finally {
    rmSync(small, { recursive: true, force: true });
  }
});
