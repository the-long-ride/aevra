import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { compileProtectedGlobs } from '../src/protected-globs.js';
import { resolveExecutable, windowsShimCommand } from '../src/spawn-target.js';

const WIN = process.platform === 'win32';

test('resolveExecutable on Windows keeps names with an extension and defaults PATHEXT', { skip: !WIN }, () => {
  assert.equal(resolveExecutable('tool.exe', { PATH: 'C:\\nowhere' }), 'tool.exe');
  assert.equal(resolveExecutable('aevra-missing-tool', {}), 'aevra-missing-tool');
  const dir = mkdtempSync(path.join(os.tmpdir(), 'aevra-spawn-br-'));
  try {
    writeFileSync(path.join(dir, 'helper.BAT'), '@echo off\r\n');
    const resolved = resolveExecutable('helper', { PATH: `;${dir};` });
    assert.equal(resolved.toLowerCase(), path.join(dir, 'helper.bat').toLowerCase());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('windowsShimCommand ignores non-shim extensions and falls back to cmd.exe', { skip: !WIN }, () => {
  assert.equal(windowsShimCommand('C:\\tools\\tool.exe', []), null);
  const saved = process.env.ComSpec;
  delete process.env.ComSpec;
  try {
    const shim = windowsShimCommand('C:\\tools\\build.BAT', ['all']);
    assert.equal(shim?.executable, 'cmd.exe');
    assert.equal(shim?.args[3], '""C:\\tools\\build.BAT" "all""');
  } finally {
    process.env.ComSpec = saved;
  }
  assert.throws(() => windowsShimCommand('C:\\to%ols\\x.cmd', []), /cannot be passed safely/);
});

test('compileProtectedGlobs drops empty lists and uncompilable patterns', () => {
  assert.equal(compileProtectedGlobs(), undefined);
  assert.equal(compileProtectedGlobs([]), undefined);
  assert.equal(compileProtectedGlobs([{ glob: '', class: 'SECRET' }]), undefined);
  const compiled = compileProtectedGlobs([
    { glob: '', class: 'SECRET' },
    { glob: 'docs/**', class: 'SENSITIVE' },
  ]);
  assert.equal(compiled?.length, 1);
  assert.equal(compiled?.[0]?.class, 'SENSITIVE');
  assert.ok(compiled?.[0]?.pattern.test('/docs/readme.md'));
});
