import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, statSync } from 'node:fs';
import { manageAgent } from '../src/manage.js';
import type { AgentTarget } from '../src/types.js';
import { workspaceFixture } from './workspace-fixture.js';

for (const target of ['codex', 'opencode'] as AgentTarget[])
  test(`install again with a new ${target} launcher rewrites the entry and keeps the credential`, async () => {
    const f = workspaceFixture();
    try {
      const first = await manageAgent(f.options({ target, executable: 'old-runner' }));
      const [reg] = first.registrations;
      const credential = readFileSync(reg.credentialFile, 'utf8');
      const stamp = statSync(reg.credentialFile).mtimeMs;
      assert.match(readFileSync(reg.config, 'utf8'), /old-runner/);

      const fresh = { target, executable: 'new-runner', entrypoint: '/new-cli.js' };
      const preview = await manageAgent(f.options({ ...fresh, dryRun: true }));
      assert.deepEqual(preview.changes, [{ target, file: reg.config, action: 'update' }]);
      assert.match(readFileSync(reg.config, 'utf8'), /old-runner/);

      const second = await manageAgent(f.options(fresh));
      assert.deepEqual(second.changes, [{ target, file: reg.config, action: 'update' }]);
      const text = readFileSync(reg.config, 'utf8');
      assert.match(text, /new-runner/);
      assert.match(text, /new-cli\.js/);
      assert.doesNotMatch(text, /old-runner/);
      const [after] = second.registrations;
      assert.equal(second.registrations.length, 1);
      assert.notEqual(after.entryHash, reg.entryHash);
      assert.equal(after.credentialId, reg.credentialId);
      assert.equal(after.credentialFile, reg.credentialFile);
      assert.equal(after.credentialHash, reg.credentialHash);
      assert.equal(readFileSync(reg.credentialFile, 'utf8'), credential);
      assert.equal(statSync(reg.credentialFile).mtimeMs, stamp);
      assert.equal(f.created.length, 1);
      assert.deepEqual(f.revoked, []);
      const status = await manageAgent(f.options({ operation: 'status' }));
      assert.equal(status.registrations[0].state, 'installed');

      const same = await manageAgent(f.options(fresh));
      assert.deepEqual(same.changes, []);
      assert.equal(readFileSync(reg.config, 'utf8'), text);

      const removed = await manageAgent(f.options({ ...fresh, operation: 'uninstall' }));
      assert.deepEqual(
        removed.changes.map((change) => change.action),
        ['remove'],
      );
      assert.doesNotMatch(readFileSync(reg.config, 'utf8'), /new-runner/);
      assert.deepEqual(f.revoked, [reg.credentialId]);
    } finally {
      f.close();
    }
  });

test('install again with identical options changes nothing', async () => {
  const f = workspaceFixture();
  try {
    const first = await manageAgent(f.options({ target: 'codex' }));
    const before = readFileSync(first.registrations[0].config, 'utf8');
    const again = await manageAgent(f.options({ target: 'codex' }));
    assert.deepEqual(again.changes, []);
    assert.equal(readFileSync(first.registrations[0].config, 'utf8'), before);
    assert.equal(again.registrations[0].entryHash, first.registrations[0].entryHash);
    assert.equal(f.created.length, 1);
  } finally {
    f.close();
  }
});
