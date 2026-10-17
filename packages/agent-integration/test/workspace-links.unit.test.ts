import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdirSync, readdirSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { manageAgent } from '../src/manage.js';
import type { AgentTarget } from '../src/types.js';
import { workspaceFixture } from './workspace-fixture.js';

const win = process.platform === 'win32';

// Junctions need no privilege on Windows; elsewhere a directory symlink is the same attack.
function linkFolder(target: string, link: string): boolean {
  try {
    symlinkSync(target, link, win ? 'junction' : 'dir');
    return true;
  } catch {
    return false;
  }
}

const cases: Array<[AgentTarget, string]> = [
  ['codex', '.codex'],
  ['antigravity', '.agents'],
];

for (const [target, folder] of cases)
  test(`a linked ${folder} folder refuses ${target} dry run and install and writes nothing outside`, async (t) => {
    const f = workspaceFixture();
    try {
      const outside = path.join(f.base, 'outside');
      mkdirSync(outside);
      if (!linkFolder(outside, path.join(f.root, folder)))
        return t.skip('directory links unavailable on this account');
      await assert.rejects(manageAgent(f.options({ target, dryRun: true })), /AGENT_PATH_CONFLICT/);
      await assert.rejects(manageAgent(f.options({ target })), /AGENT_PATH_CONFLICT/);
      assert.deepEqual(readdirSync(outside), []);
      assert.equal(f.created.length, 0);
      assert.ok(!existsSync(path.join(f.home, '.agents')));
    } finally {
      f.close();
    }
  });

test('a workspace root that is itself a link is accepted and writes inside the real folder', async (t) => {
  const f = workspaceFixture();
  try {
    const alias = path.join(f.base, 'alias');
    if (!linkFolder(f.root, alias)) return t.skip('directory links unavailable on this account');
    const options = { target: 'codex' as const, workspaceRoot: alias };
    const result = await manageAgent(f.options(options));
    assert.equal(result.changes.length, 1);
    assert.ok(existsSync(path.join(f.root, '.codex/config.toml')));
    const removed = await manageAgent(f.options({ ...options, operation: 'uninstall' }));
    assert.deepEqual(
      removed.changes.map((change) => change.action),
      ['remove'],
    );
  } finally {
    f.close();
  }
});
