import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { detectAgents } from '../src/detect.js';
import { AGENT_TARGETS } from '../src/types.js';

function sandbox<T>(run: (home: string, bin: string) => T): T {
  const home = mkdtempSync(path.join(tmpdir(), 'aevra-detect-'));
  const bin = path.join(home, 'bin');
  mkdirSync(bin);
  try {
    return run(home, bin);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

function byTarget(list: ReturnType<typeof detectAgents>, target: string) {
  const entry = list.find((item) => item.target === target);
  assert.ok(entry, `missing ${target}`);
  return entry;
}

test('nothing present gives one not-found entry per target in order', () =>
  sandbox((home, bin) => {
    const list = detectAgents({ home, env: { PATH: bin } });
    assert.deepEqual(
      list.map((item) => item.target),
      [...AGENT_TARGETS],
    );
    for (const item of list) {
      assert.equal(item.found, false);
      assert.equal(item.evidence, 'none');
      assert.deepEqual(item.scopes, ['user', 'workspace']);
    }
    assert.equal(byTarget(list, 'codex').configPath, path.join(home, '.codex'));
    assert.equal(byTarget(list, 'claude-code').configPath, path.join(home, '.claude.json'));
    assert.equal(byTarget(list, 'opencode').configPath, path.join(home, '.config', 'opencode'));
    assert.equal(byTarget(list, 'antigravity').configPath, path.join(home, '.gemini', 'antigravity'));
    assert.equal(byTarget(list, 'antigravity-cli').configPath, path.join(home, '.gemini', 'antigravity-cli'));
    assert.equal(byTarget(list, 'antigravity-ide').configPath, path.join(home, '.gemini', 'config'));
  }));

test('an executable on PATH is found with path evidence', () =>
  sandbox((home, bin) => {
    writeFileSync(path.join(bin, 'codex'), 'plain words');
    const entry = byTarget(detectAgents({ home, env: { PATH: bin }, platform: 'linux' }), 'codex');
    assert.equal(entry.found, true);
    assert.equal(entry.evidence, 'path');
    assert.equal(byTarget(detectAgents({ home, env: { PATH: bin } }), 'opencode').found, false);
  }));

test('win32 tries every PATHEXT suffix', () =>
  sandbox((home, bin) => {
    writeFileSync(path.join(bin, 'claude.CMD'), 'plain words');
    const env = { PATH: bin, PATHEXT: '.EXE;.CMD' };
    const entry = byTarget(detectAgents({ home, env, platform: 'win32' }), 'claude-code');
    assert.equal(entry.found, true);
    assert.equal(entry.evidence, 'path');
    const other = detectAgents({ home, env: { PATH: bin, PATHEXT: '.EXE' }, platform: 'win32' });
    assert.equal(byTarget(other, 'claude-code').found, false);
  }));

test('win32 also accepts the bare name and skips empty PATH entries', () =>
  sandbox((home, bin) => {
    writeFileSync(path.join(bin, 'opencode'), 'plain words');
    const env = { PATH: `;;${bin};`, PATHEXT: '.EXE' };
    const entry = byTarget(detectAgents({ home, env, platform: 'win32' }), 'opencode');
    assert.equal(entry.evidence, 'path');
  }));

test('a directory named like the executable is not found', () =>
  sandbox((home, bin) => {
    mkdirSync(path.join(bin, 'antigravity'));
    const entry = byTarget(detectAgents({ home, env: { PATH: bin } }), 'antigravity');
    assert.equal(entry.found, false);
    assert.equal(entry.evidence, 'none');
  }));

test('an empty PATH entry is not the current directory', () =>
  sandbox((home) => {
    const entry = byTarget(detectAgents({ home, env: { PATH: '' } }), 'codex');
    assert.equal(entry.found, false);
    assert.equal(byTarget(detectAgents({ home, env: {} }), 'codex').found, false);
  }));

test('CODEX_HOME that exists gives config evidence and that configPath', () =>
  sandbox((home, bin) => {
    const codexHome = path.join(home, 'custom-codex');
    mkdirSync(codexHome);
    const entry = byTarget(
      detectAgents({ home, env: { PATH: bin, CODEX_HOME: codexHome } }),
      'codex',
    );
    assert.equal(entry.found, true);
    assert.equal(entry.evidence, 'config');
    assert.equal(entry.configPath, codexHome);
  }));

test('path evidence wins over config evidence and keeps configPath', () =>
  sandbox((home, bin) => {
    mkdirSync(path.join(home, '.codex'));
    writeFileSync(path.join(bin, 'codex'), 'plain words');
    const entry = byTarget(detectAgents({ home, env: { PATH: bin } }), 'codex');
    assert.equal(entry.evidence, 'path');
    assert.equal(entry.configPath, path.join(home, '.codex'));
  }));

test('a .claude.json file alone detects claude-code', () =>
  sandbox((home, bin) => {
    writeFileSync(path.join(home, '.claude.json'), '{}');
    const entry = byTarget(detectAgents({ home, env: { PATH: bin } }), 'claude-code');
    assert.equal(entry.found, true);
    assert.equal(entry.evidence, 'config');
    assert.equal(entry.configPath, path.join(home, '.claude.json'));
  }));

test('a .claude directory alone detects claude-code', () =>
  sandbox((home, bin) => {
    mkdirSync(path.join(home, '.claude'));
    const entry = byTarget(detectAgents({ home, env: { PATH: bin } }), 'claude-code');
    assert.equal(entry.evidence, 'config');
  }));

test('CLAUDE_CONFIG_DIR moves the claude config file and home', () =>
  sandbox((home, bin) => {
    const dir = path.join(home, 'claude-elsewhere');
    mkdirSync(dir);
    writeFileSync(path.join(home, '.claude.json'), '{}');
    const env = { PATH: bin, CLAUDE_CONFIG_DIR: dir };
    const entry = byTarget(detectAgents({ home, env }), 'claude-code');
    assert.equal(entry.evidence, 'config');
    assert.equal(entry.configPath, path.join(dir, '.claude.json'));
    rmSync(dir, { recursive: true, force: true });
    const gone = byTarget(detectAgents({ home, env }), 'claude-code');
    assert.equal(gone.found, false);
    assert.equal(gone.configPath, path.join(dir, '.claude.json'));
  }));

test('antigravity is found by ~/.gemini alone', () =>
  sandbox((home, bin) => {
    mkdirSync(path.join(home, '.gemini'));
    const entry = byTarget(detectAgents({ home, env: { PATH: bin } }), 'antigravity');
    assert.equal(entry.found, true);
    assert.equal(entry.evidence, 'config');
    assert.equal(entry.configPath, path.join(home, '.gemini', 'antigravity'));
  }));

test('antigravity variants are found by their directories and executables', () =>
  sandbox((home, bin) => {
    writeFileSync(path.join(bin, 'agy'), 'plain words');
    const cliByPath = byTarget(
      detectAgents({ home, env: { PATH: bin }, platform: 'linux' }),
      'antigravity-cli',
    );
    assert.equal(cliByPath.found, true);
    assert.equal(cliByPath.evidence, 'path');

    mkdirSync(path.join(home, '.gemini', 'config'), { recursive: true });
    const ideByConfig = byTarget(
      detectAgents({ home, env: { PATH: bin }, platform: 'linux' }),
      'antigravity-ide',
    );
    assert.equal(ideByConfig.found, true);
    assert.equal(ideByConfig.evidence, 'config');
    assert.equal(ideByConfig.configPath, path.join(home, '.gemini', 'config'));
  }));

test('opencode configPath honours XDG_CONFIG_HOME', () =>
  sandbox((home, bin) => {
    const xdg = path.join(home, 'xdg');
    const env = { PATH: bin, XDG_CONFIG_HOME: xdg };
    const missing = byTarget(detectAgents({ home, env }), 'opencode');
    assert.equal(missing.configPath, path.join(xdg, 'opencode'));
    assert.equal(missing.found, false);
    mkdirSync(path.join(xdg, 'opencode'), { recursive: true });
    const entry = byTarget(detectAgents({ home, env }), 'opencode');
    assert.equal(entry.evidence, 'config');
    assert.equal(entry.configPath, path.join(xdg, 'opencode'));
  }));

test('OPENCODE_CONFIG that exists is config evidence and the configPath', () =>
  sandbox((home, bin) => {
    const file = path.join(home, 'elsewhere.json');
    writeFileSync(file, '{}');
    const entry = byTarget(
      detectAgents({ home, env: { PATH: bin, OPENCODE_CONFIG: file } }),
      'opencode',
    );
    assert.equal(entry.evidence, 'config');
    assert.equal(entry.configPath, file);
  }));

test('a config home that is a plain file is not a home', () =>
  sandbox((home, bin) => {
    writeFileSync(path.join(home, '.codex'), 'plain words');
    assert.equal(byTarget(detectAgents({ home, env: { PATH: bin } }), 'codex').found, false);
  }));
