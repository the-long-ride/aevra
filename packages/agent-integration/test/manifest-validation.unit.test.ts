import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { manageAgent } from '../src/manage.js';
import { agentLocation } from '../src/adapters.js';
import type { AgentTarget } from '../src/types.js';
import { manifestFixture } from './manifest-fixture.js';

const INVALID = /AGENT_MANIFEST_INVALID/;

test('a v1 manifest upgrades every target to user scope with its own entry path', async () => {
  const expected: Record<AgentTarget, string[]> = {
    codex: ['mcp_servers'],
    'claude-code': ['mcpServers'],
    opencode: ['mcp'],
    antigravity: ['mcpServers'],
  };
  for (const [target, entryPath] of Object.entries(expected)) {
    const f = manifestFixture();
    try {
      f.save(1, [f.reg({ target })]);
      const status = await manageAgent({ ...f.options, target: target as AgentTarget });
      assert.equal(status.registrations[0].scope, 'user', target);
      assert.deepEqual(status.registrations[0].entryPath, entryPath, target);
    } finally {
      f.close();
    }
  }
});

test('an unreadable Claude config only marks the workspace claude-code registration', async () => {
  const f = manifestFixture();
  const root = path.join(f.home, 'work', 'alpha');
  try {
    mkdirSync(path.join(f.home, '.claude.json'));
    const key = root.replaceAll('\\', '/');
    f.save(2, [
      f.reg({ scope: 'user', entryPath: ['mcp_servers'] }),
      f.reg({
        target: 'claude-code',
        scope: 'workspace',
        workspaceRoot: root,
        config: path.join(f.home, '.claude.json'),
        entryPath: ['projects', key, 'mcpServers'],
      }),
    ]);
    const status = await manageAgent(f.options);
    const state = (target: string) => status.registrations.find((r) => r.target === target)?.state;
    assert.equal(state('claude-code'), 'conflict');
    assert.equal(state('codex'), 'incomplete');
  } finally {
    f.close();
  }
});

function workspaceReg(f: ReturnType<typeof manifestFixture>, target: AgentTarget, root: string) {
  const location = agentLocation(target, f.home, {}, 'workspace', root, 'unused');
  return f.reg({
    target,
    scope: 'workspace',
    workspaceRoot: root,
    config: location.config,
    entryPath: location.entryPath.map((segment) => (segment === 'unused' ? root : segment)),
  });
}

test('a hand-edited workspace root must be absolute and normalised', async () => {
  const f = manifestFixture();
  try {
    const good = path.join(f.home, 'work', 'alpha');
    f.save(2, [workspaceReg(f, 'codex', good)]);
    assert.equal((await manageAgent(f.options)).registrations.length, 1);
    const dotted = `${f.home}${path.sep}work${path.sep}..${path.sep}x`;
    for (const root of ['work/alpha', '', dotted, `${good}${path.sep}`]) {
      const entry = {
        ...workspaceReg(f, 'codex', good),
        workspaceRoot: root,
        config: path.join(root || 'x', '.codex', 'config.toml'),
      };
      f.save(2, [entry]);
      await assert.rejects(manageAgent(f.options), INVALID, JSON.stringify(root));
    }
  } finally {
    f.close();
  }
});

test('a stored entryPath must match the computed one', async () => {
  const f = manifestFixture();
  const root = path.join(f.home, 'work', 'alpha');
  try {
    f.save(2, [f.reg({ scope: 'user', entryPath: ['other'] })]);
    await assert.rejects(manageAgent(f.options), INVALID);
    f.save(2, [f.reg({ scope: 'user', entryPath: ['mcp_servers', 'extra'] })]);
    await assert.rejects(manageAgent(f.options), INVALID);
    f.save(2, [{ ...workspaceReg(f, 'opencode', root), entryPath: ['mcpServers'] }]);
    await assert.rejects(manageAgent(f.options), INVALID);
  } finally {
    f.close();
  }
});

test('a workspace claude-code key must equal the root ignoring case and slash direction', async () => {
  const f = manifestFixture();
  const root = path.join(f.home, 'work', 'alpha');
  try {
    const good = workspaceReg(f, 'claude-code', root);
    const withKey = (...entryPath: string[]) => ({ ...good, entryPath });
    const loose = root.replaceAll('\\', '/').toUpperCase();
    f.save(2, [withKey('projects', loose, 'mcpServers')]);
    // Case is ignored only where file systems usually ignore it (win32, darwin).
    if (process.platform === 'win32' || process.platform === 'darwin')
      assert.equal((await manageAgent(f.options)).registrations.length, 1);
    else await assert.rejects(manageAgent(f.options), INVALID);
    f.save(2, [withKey('projects', root.replaceAll('\\', '/'), 'mcpServers')]);
    assert.equal((await manageAgent(f.options)).registrations.length, 1);
    for (const bad of [
      ['projects', 'F:/elsewhere', 'mcpServers'],
      ['projects', root],
      ['projects', root, 'other'],
      ['mcpServers'],
      ['other', root, 'mcpServers'],
    ]) {
      f.save(2, [withKey(...bad)]);
      await assert.rejects(manageAgent(f.options), INVALID, bad.join('|'));
    }
  } finally {
    f.close();
  }
});

test('workspace roots that differ only in case are one registration where case is ignored', async () => {
  const f = manifestFixture();
  try {
    const upper = path.join(f.home, 'work', 'Alpha');
    const lower = path.join(f.home, 'work', 'alpha');
    f.save(2, [workspaceReg(f, 'codex', upper), workspaceReg(f, 'codex', lower)]);
    if (process.platform === 'win32' || process.platform === 'darwin')
      await assert.rejects(manageAgent(f.options), INVALID);
    else assert.equal((await manageAgent(f.options)).registrations.length, 2);
  } finally {
    f.close();
  }
});
