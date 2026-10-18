import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { findGit } from '../src/project-guard.js';

const win = process.platform === 'win32';

function sandbox() {
  const base = mkdtempSync(path.join(tmpdir(), 'aevra-git-'));
  const root = path.join(base, 'project folder with a long name');
  const tools = path.join(root, 'tools');
  mkdirSync(tools, { recursive: true });
  // A file that looks like git to the PATH search; it is never started.
  writeFileSync(path.join(tools, 'git.exe'), 'plain words');
  return { base, root, tools, close: () => rmSync(base, { recursive: true, force: true }) };
}

// The 8.3 form of a folder, or null when the volume does not create short names.
function shortName(dir: string): string | null {
  try {
    const out = execFileSync('cmd.exe', ['/d', '/c', `for %I in ("${dir}") do @echo %~sI`], {
      encoding: 'utf8',
      windowsHide: true,
    }).trim();
    return out && out.toLowerCase() !== dir.toLowerCase() && !out.includes(' ') ? out : null;
  } catch {
    return null;
  }
}

test('findGit refuses in-workspace PATH entries written with a device prefix', (t) => {
  if (!win) return t.skip('device-path prefixes exist only on Windows');
  const f = sandbox();
  try {
    for (const prefix of ['\\\\?\\', '\\\\.\\']) {
      const entry = `${prefix}${f.tools}`;
      assert.equal(findGit(f.root, { PATH: entry }), null, `accepted ${entry}`);
      assert.equal(findGit(f.root, { PATH: `"${entry}"` }), null, `accepted quoted ${entry}`);
    }
  } finally {
    f.close();
  }
});

test('findGit refuses an in-workspace PATH entry written as an 8.3 short name', (t) => {
  if (!win) return t.skip('8.3 short names exist only on Windows');
  const f = sandbox();
  try {
    const alias = shortName(f.tools);
    if (!alias) return t.skip('8.3 short names are not created on this volume');
    assert.equal(findGit(f.root, { PATH: alias }), null, `accepted ${alias}`);
    const rootAlias = shortName(f.root);
    if (rootAlias) assert.equal(findGit(rootAlias, { PATH: f.tools }), null);
  } finally {
    f.close();
  }
});
