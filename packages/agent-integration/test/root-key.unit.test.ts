import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { rootKey } from '../src/claude-project-key.js';
import { manageAgent } from '../src/manage.js';
import { workspaceFixture } from './workspace-fixture.js';

test('workspace roots compare loosely only where file systems usually ignore case', () => {
  for (const platform of ['win32', 'darwin'] as const) {
    assert.equal(rootKey('F:\\Work\\Proj\\', platform), rootKey('f:/work/proj', platform));
    assert.equal(rootKey('/src/Proj', platform), rootKey('/src/proj', platform));
  }
  for (const platform of ['linux', 'freebsd'] as const) {
    assert.notEqual(rootKey('/src/Proj', platform), rootKey('/src/proj', platform));
    assert.equal(rootKey('/src/proj', platform), rootKey('/src/proj', platform));
  }
});

test('on a case-sensitive platform two folders differing in case get their own registration', async (t) => {
  if (process.platform === 'win32' || process.platform === 'darwin')
    return t.skip('this platform treats both spellings as one folder');
  const f = workspaceFixture();
  try {
    const upper = path.join(f.base, 'Proj');
    const lower = path.join(f.base, 'proj');
    mkdirSync(upper);
    mkdirSync(lower);
    await manageAgent(f.options({ workspaceRoot: upper }));
    const second = await manageAgent(f.options({ workspaceRoot: lower }));
    const file = path.join(lower, '.codex', 'config.toml');
    assert.deepEqual(second.changes, [{ target: 'codex', file, action: 'create' }]);
    assert.ok(existsSync(file));
    assert.deepEqual(
      second.registrations.map((reg) => reg.workspaceRoot).sort(),
      [lower, upper].sort(),
    );
  } finally {
    f.close();
  }
});
