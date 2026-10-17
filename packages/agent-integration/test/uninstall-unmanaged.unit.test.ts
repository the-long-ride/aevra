import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { manageAgent } from '../src/manage.js';
import { workspaceFixture } from './workspace-fixture.js';

const user = { scope: 'user' as const, workspaceRoot: undefined };
const handWritten = '{\n  "mcp": { "aevra": { "type": "local", "command": ["by-hand"] } }\n}\n';

function plantForeign(home: string): string {
  const file = path.join(home, '.config/opencode/opencode.json');
  mkdirSync(path.join(home, '.config/opencode/skills/aevra'), { recursive: true });
  writeFileSync(path.join(home, '.config/opencode/skills/aevra/SKILL.md'), 'plain words\n');
  writeFileSync(file, handWritten);
  return file;
}

test('uninstall all removes our codex entry and leaves a hand-written opencode entry alone', async () => {
  const f = workspaceFixture();
  try {
    await manageAgent(f.options({ ...user, target: 'codex' }));
    const foreign = plantForeign(f.home);
    const result = await manageAgent(
      f.options({
        operation: 'uninstall',
        target: 'all',
        scope: undefined,
        workspaceRoot: undefined,
      }),
    );
    assert.deepEqual(
      result.changes.map((change) => [change.target, change.action]),
      [['codex', 'remove']],
    );
    assert.deepEqual(result.registrations, []);
    assert.doesNotMatch(readFileSync(path.join(f.home, '.codex/config.toml'), 'utf8'), /BEGIN/);
    assert.equal(readFileSync(foreign, 'utf8'), handWritten);
    assert.ok(existsSync(path.join(f.home, '.config/opencode/skills/aevra/SKILL.md')));
    assert.equal(f.revoked.length, 1);
  } finally {
    f.close();
  }
});

test('uninstall of an agent Aevra never registered is a clear no-op; install still refuses', async () => {
  const f = workspaceFixture();
  try {
    const foreign = plantForeign(f.home);
    const options = f.options({ ...user, operation: 'uninstall', target: 'opencode' });
    const preview = await manageAgent({ ...options, dryRun: true });
    assert.deepEqual(preview.changes, []);
    const alone = await manageAgent(options);
    assert.deepEqual(alone.changes, []);
    assert.match(alone.message, /nothing to remove/i);
    assert.equal(readFileSync(foreign, 'utf8'), handWritten);
    assert.ok(!existsSync(path.join(f.home, '.agents')));
    await assert.rejects(
      manageAgent(f.options({ ...user, target: 'opencode' })),
      /AGENT_CONFIG_CONFLICT/,
    );
    assert.equal(f.created.length, 0);
  } finally {
    f.close();
  }
});
