import assert from 'node:assert/strict';
import test from 'node:test';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { assertNotTracked, excludeFromGit, findGit, runGit } from '../src/project-guard.js';

const win = process.platform === 'win32';
const gitName = win ? 'git.exe' : 'git';

function sandbox() {
  const base = mkdtempSync(path.join(tmpdir(), 'aevra-git-'));
  const root = path.join(base, 'project');
  mkdirSync(root);
  return { base, root, close: () => rmSync(base, { recursive: true, force: true }) };
}

// A file that looks like git to the PATH search; it is never started by these tests.
function fakeGit(dir: string): string {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, gitName);
  writeFileSync(file, 'plain words');
  if (!win) chmodSync(file, 0o755);
  return file;
}

function withEnv<T>(name: string, value: string | undefined, run: () => T): T {
  const before = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  try {
    return run();
  } finally {
    if (before === undefined) delete process.env[name];
    else process.env[name] = before;
  }
}

const sameFile = (found: string | null, expected: string) =>
  assert.equal(win ? found?.toLowerCase() : found, win ? expected.toLowerCase() : expected);

test('the git guard never starts a git binary planted in the workspace folder', () => {
  const f = sandbox();
  try {
    // A copy of node named git: if it ever runs, the preload below writes the marker file.
    const planted = path.join(f.root, gitName);
    copyFileSync(process.execPath, planted);
    if (!win) chmodSync(planted, 0o755);
    const marker = path.join(f.base, 'marker.txt');
    const payload = path.join(f.base, 'payload.cjs');
    writeFileSync(payload, `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran');\n`);
    const searchPath = (process.env.PATH ?? '')
      .split(path.delimiter)
      .filter((dir) => dir && path.resolve(dir) !== path.resolve(f.root))
      .join(path.delimiter);
    const file = path.join(f.root, 'opencode.json');
    withEnv('NODE_OPTIONS', `--require ${JSON.stringify(payload)}`, () =>
      withEnv('PATH', searchPath, () => {
        runGit(f.root, ['--version']);
        assertNotTracked(file, f.root);
        excludeFromGit(file, f.root, false);
      }),
    );
    assert.equal(existsSync(marker), false, 'the planted git was executed');
  } finally {
    f.close();
  }
});

test('findGit skips empty, relative and in-workspace PATH entries', () => {
  const f = sandbox();
  try {
    fakeGit(f.root);
    fakeGit(path.join(f.root, 'tools'));
    const expected = fakeGit(path.join(f.base, 'bin'));
    const entries = ['', '.', 'relative', f.root, path.join(f.root, 'tools')];
    const env = { PATH: [...entries, path.join(f.base, 'bin')].join(path.delimiter) };
    sameFile(findGit(f.root, { ...env, PATHEXT: '.COM;.EXE;.BAT' }), expected);
    assert.equal(findGit(f.root, { PATH: entries.join(path.delimiter) }), null);
    assert.equal(findGit(f.root, {}), null);
    if (win) sameFile(findGit(f.root, { Path: env.PATH }), expected);
  } finally {
    f.close();
  }
});

test('findGit refuses a PATH entry that links into the workspace folder', (t) => {
  const f = sandbox();
  try {
    fakeGit(path.join(f.root, 'tools'));
    const link = path.join(f.base, 'linked');
    try {
      symlinkSync(path.join(f.root, 'tools'), link, win ? 'junction' : 'dir');
    } catch {
      return t.skip('directory links unavailable on this account');
    }
    assert.equal(findGit(f.root, { PATH: link }), null);
  } finally {
    f.close();
  }
});

test('with no usable git the guard reports git as missing and skips', () => {
  const f = sandbox();
  try {
    fakeGit(f.root);
    withEnv('PATH', f.root, () => {
      const result = runGit(f.root, ['--version']);
      assert.equal(result.missing, true);
      assertNotTracked(path.join(f.root, 'opencode.json'), f.root);
      assert.equal(excludeFromGit(path.join(f.root, 'opencode.json'), f.root, false), 'skipped');
    });
  } finally {
    f.close();
  }
});
