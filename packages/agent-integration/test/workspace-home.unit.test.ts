import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { manageAgent } from '../src/manage.js';
import { workspaceFixture } from './workspace-fixture.js';

test('a workspace install into the home folder is refused and writes nothing', async () => {
  const f = workspaceFixture();
  try {
    const options = f.options({ target: 'codex', workspaceRoot: f.home });
    const expected = /AGENT_OPTIONS_INVALID: .*home folder or a filesystem root/;
    await assert.rejects(manageAgent({ ...options, dryRun: true }), expected);
    await assert.rejects(manageAgent(options), expected);
    assert.deepEqual(readdirSync(f.home), []);
    assert.equal(f.created.length, 0);
  } finally {
    f.close();
  }
});

test('a workspace install into a filesystem root is refused (dry run only)', async () => {
  const f = workspaceFixture();
  try {
    const top = path.parse(f.root).root;
    await assert.rejects(
      manageAgent(f.options({ target: 'codex', workspaceRoot: top, dryRun: true })),
      /AGENT_OPTIONS_INVALID: .*home folder or a filesystem root/,
    );
  } finally {
    f.close();
  }
});

test('a workspace config that is the user-scope config of the agent is refused', async () => {
  const f = workspaceFixture();
  try {
    const env = { CODEX_HOME: path.join(f.root, '.codex') };
    await assert.rejects(
      manageAgent(f.options({ target: 'codex', env })),
      /AGENT_OPTIONS_INVALID: .*user-scope config of codex/,
    );
    assert.ok(!existsSync(path.join(f.root, '.codex')));
    const other = await manageAgent(f.options({ target: 'opencode', env }));
    assert.equal(other.changes.length, 1);
  } finally {
    f.close();
  }
});
