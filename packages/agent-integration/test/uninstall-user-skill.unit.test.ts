import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { manageAgent } from '../src/manage.js';
import { workspaceFixture } from './workspace-fixture.js';

for (const scope of [undefined, 'all'] as const)
  test(`uninstall all (scope ${scope ?? 'not given'}) with only workspace registrations leaves the user skill alone`, async () => {
    const f = workspaceFixture();
    const user = { scope: 'user' as const, workspaceRoot: undefined };
    try {
      await manageAgent(f.options(user));
      const file = path.join(f.home, '.agents', 'skills', 'aevra', 'SKILL.md');
      const content = readFileSync(file, 'utf8');
      await manageAgent(f.options());
      await manageAgent(f.options({ ...user, operation: 'uninstall' }));
      assert.equal(existsSync(file), false);
      // The user puts back a file of the same text: no user registration owns it any more.
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, content);

      const out = await manageAgent(
        f.options({ target: 'all', operation: 'uninstall', scope, workspaceRoot: undefined }),
      );
      assert.deepEqual(
        out.changes.map((change) => [change.target, change.action]),
        [['codex', 'remove']],
      );
      assert.equal(readFileSync(file, 'utf8'), content);
    } finally {
      f.close();
    }
  });
