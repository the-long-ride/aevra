import assert from 'node:assert/strict';
import test from 'node:test';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { manageAgent } from '../src/manage.js';
import { AGENT_TARGETS } from '../src/types.js';
import { loosePath } from '../src/claude-project-key.js';
import { workspaceFixture } from './workspace-fixture.js';

const userPaths = ['.agents', '.claude', '.codex', '.config', '.gemini'];

for (const target of AGENT_TARGETS) {
  test(`workspace install of ${target} writes only its own entry and no skill`, async () => {
    const f = workspaceFixture();
    try {
      const result = await manageAgent(f.options({ target }));
      const [reg] = result.registrations;
      assert.equal(result.registrations.length, 1);
      assert.equal(reg.scope, 'workspace');
      assert.equal(reg.workspaceRoot, path.resolve(f.root));
      assert.deepEqual(reg.links, []);
      assert.deepEqual(result.changes, [{ target, file: reg.config, action: 'create' }]);
      for (const name of userPaths)
        if (name !== '.agents') assert.ok(!existsSync(path.join(f.home, name)), name);
      assert.ok(!existsSync(path.join(f.home, '.agents/skills')));
      if (target === 'claude-code') {
        assert.deepEqual(readdirSync(f.root), []);
        const projects = JSON.parse(
          readFileSync(path.join(f.home, '.claude.json'), 'utf8'),
        ).projects;
        assert.deepEqual(Object.keys(projects), [reg.entryPath[1]]);
        assert.equal(loosePath(reg.entryPath[1]), loosePath(f.root));
        assert.ok(projects[reg.entryPath[1]].mcpServers.aevra);
      } else {
        assert.ok(reg.config.startsWith(f.root));
        assert.ok(existsSync(reg.config));
        assert.ok(!existsSync(path.join(f.home, '.claude.json')));
      }
      if (target === 'codex') assert.ok(result.notes.some((note) => /trusted/i.test(note)));
      assert.ok(result.notes.some((note) => /no skill/i.test(note)));
      const status = await manageAgent(f.options({ operation: 'status' }));
      assert.equal(status.registrations[0].state, 'installed');
    } finally {
      f.close();
    }
  });
}

test('workspace scope refuses http, relative, missing and non-directory roots without writing', async () => {
  const f = workspaceFixture();
  try {
    await assert.rejects(
      manageAgent(f.options({ transport: 'http' })),
      /AGENT_OPTIONS_INVALID: workspace scope requires stdio/,
    );
    await assert.rejects(
      manageAgent(f.options({ workspaceRoot: 'project/relative' })),
      /AGENT_OPTIONS_INVALID: workspaceRoot must be an absolute path/,
    );
    await assert.rejects(
      manageAgent(f.options({ workspaceRoot: undefined })),
      /AGENT_OPTIONS_INVALID: workspaceRoot must be an absolute path/,
    );
    await assert.rejects(
      manageAgent(f.options({ workspaceRoot: path.join(f.base, 'absent') })),
      /AGENT_OPTIONS_INVALID: workspaceRoot must be an existing directory/,
    );
    const file = path.join(f.base, 'plain.txt');
    writeFileSync(file, 'text');
    await assert.rejects(
      manageAgent(f.options({ workspaceRoot: file })),
      /AGENT_OPTIONS_INVALID: workspaceRoot must be an existing directory/,
    );
    await assert.rejects(
      manageAgent(f.options({ scope: 'user', workspaceRoot: f.root })),
      /AGENT_OPTIONS_INVALID: workspaceRoot requires workspace scope/,
    );
    await assert.rejects(
      manageAgent(
        f.options({
          scope: 'user',
          workspaceRoot: undefined,
          dryRun: true,
          transport: 'x' as never,
        }),
      ),
      /Error: AGENT_OPTIONS_INVALID$/,
    );
    assert.equal(f.created.length, 0);
    assert.deepEqual(readdirSync(f.home), []);
    assert.deepEqual(readdirSync(f.root), []);
  } finally {
    f.close();
  }
});

test('user and workspace registrations coexist and uninstall removes only the matching one', async () => {
  const f = workspaceFixture();
  const user = { scope: 'user' as const, workspaceRoot: undefined };
  try {
    await manageAgent(f.options(user));
    await manageAgent(f.options());
    const both = await manageAgent(f.options({ operation: 'status' }));
    assert.deepEqual(both.registrations.map((reg) => reg.scope).sort(), ['user', 'workspace']);
    const userConfig = path.join(f.home, '.codex/config.toml');
    const workspaceConfig = path.join(f.root, '.codex/config.toml');
    assert.match(readFileSync(userConfig, 'utf8'), /BEGIN aevra managed/);
    assert.match(readFileSync(workspaceConfig, 'utf8'), /BEGIN aevra managed/);

    const removed = await manageAgent(f.options({ operation: 'uninstall' }));
    assert.deepEqual(removed.changes, [
      { target: 'codex', file: workspaceConfig, action: 'remove' },
    ]);
    assert.doesNotMatch(readFileSync(workspaceConfig, 'utf8'), /BEGIN aevra/);
    assert.match(readFileSync(userConfig, 'utf8'), /BEGIN aevra managed/);
    assert.deepEqual(
      removed.registrations.map((reg) => reg.scope),
      ['user'],
    );

    await manageAgent(f.options());
    await manageAgent(f.options({ operation: 'uninstall', ...user }));
    const left = await manageAgent(f.options({ operation: 'status' }));
    assert.deepEqual(
      left.registrations.map((reg) => reg.scope),
      ['workspace'],
    );
    assert.doesNotMatch(readFileSync(userConfig, 'utf8'), /BEGIN aevra/);
    assert.match(readFileSync(workspaceConfig, 'utf8'), /BEGIN aevra managed/);

    await manageAgent(f.options(user));
    await manageAgent(
      f.options({ operation: 'uninstall', target: 'all', scope: 'user', workspaceRoot: undefined }),
    );
    assert.equal((await manageAgent(f.options({ operation: 'status' }))).registrations.length, 1);
    await manageAgent(f.options(user));
    await manageAgent(
      f.options({
        operation: 'uninstall',
        target: 'all',
        scope: undefined,
        workspaceRoot: undefined,
      }),
    );
    assert.equal((await manageAgent(f.options({ operation: 'status' }))).registrations.length, 0);
    assert.ok(!existsSync(path.join(f.home, '.agents/aevra/aevra.json')));
    assert.equal(f.revoked.length, f.created.length);
  } finally {
    f.close();
  }
});

test('an existing opencode project file keeps its comments and other content', async () => {
  const f = workspaceFixture();
  const file = path.join(f.root, 'opencode.jsonc');
  writeFileSync(file, '{\n  // keep this note\n  "theme": "plain",\n}\n');
  try {
    const result = await manageAgent(f.options({ target: 'opencode' }));
    assert.equal(result.registrations[0].config, file);
    assert.deepEqual(result.changes, [{ target: 'opencode', file, action: 'update' }]);
    assert.match(readFileSync(file, 'utf8'), /\/\/ keep this note/);
    assert.match(readFileSync(file, 'utf8'), /"theme": "plain"/);
    assert.ok(!existsSync(path.join(f.root, 'opencode.json')));
    await manageAgent(f.options({ target: 'opencode', operation: 'uninstall' }));
    assert.match(readFileSync(file, 'utf8'), /\/\/ keep this note/);
    assert.match(readFileSync(file, 'utf8'), /"theme": "plain"/);
    assert.doesNotMatch(readFileSync(file, 'utf8'), /pelican|credential-file/);
  } finally {
    f.close();
  }
});

test('dry run reports changes for install and uninstall and writes nothing', async () => {
  const f = workspaceFixture();
  try {
    const plan = await manageAgent(f.options({ target: 'all', dryRun: true }));
    assert.equal(plan.dryRun, true);
    assert.deepEqual(plan.changes.map((change) => change.target).sort(), [...AGENT_TARGETS].sort());
    assert.ok(plan.changes.every((change) => change.action === 'create'));
    assert.ok(plan.notes.length > 0);
    assert.equal(f.created.length, 0);
    assert.deepEqual(readdirSync(f.home), []);
    assert.deepEqual(readdirSync(f.root), []);
    await manageAgent(f.options({ target: 'codex' }));
    const again = await manageAgent(f.options({ target: 'codex', dryRun: true }));
    assert.deepEqual(again.changes, []);
    const removal = await manageAgent(
      f.options({ target: 'codex', operation: 'uninstall', dryRun: true }),
    );
    assert.deepEqual(
      removal.changes.map((change) => change.action),
      ['remove'],
    );
    assert.match(readFileSync(path.join(f.root, '.codex/config.toml'), 'utf8'), /BEGIN aevra/);
  } finally {
    f.close();
  }
});

test('Claude reuses an existing project key in another form and uninstall edits only that key', async () => {
  const f = workspaceFixture();
  const resolved = path.resolve(f.root);
  const key = (
    resolved.includes('\\') ? resolved.replaceAll('\\', '/') : resolved.replaceAll('/', '\\')
  ).toUpperCase();
  assert.notEqual(key, resolved);
  const config = path.join(f.home, '.claude.json');
  const neighbour = { mcpServers: { keep: { command: 'tool' } } };
  writeFileSync(
    config,
    JSON.stringify({ projects: { [key]: { note: 'plain' }, other: neighbour } }),
  );
  try {
    const result = await manageAgent(f.options({ target: 'claude-code' }));
    assert.equal(result.registrations[0].entryPath[1], key);
    assert.ok(!result.notes.some((note) => /start Claude Code/i.test(note)));
    const after = JSON.parse(readFileSync(config, 'utf8'));
    assert.deepEqual(Object.keys(after.projects), [key, 'other']);
    assert.ok(after.projects[key].mcpServers.aevra);
    assert.equal(after.projects[key].note, 'plain');
    await manageAgent(f.options({ target: 'claude-code', operation: 'uninstall' }));
    const final = JSON.parse(readFileSync(config, 'utf8'));
    assert.equal(final.projects[key].mcpServers?.aevra, undefined);
    assert.equal(final.projects[key].note, 'plain');
    assert.deepEqual(final.projects.other, neighbour);
    assert.deepEqual(readdirSync(f.root), []);
  } finally {
    f.close();
  }
});

test('Claude writes a forward-slash key for an unknown folder and says to start Claude Code there', async () => {
  const f = workspaceFixture();
  try {
    const result = await manageAgent(f.options({ target: 'claude-code' }));
    assert.ok(result.notes.some((note) => /start Claude Code in that folder/i.test(note)));
    assert.ok(!result.registrations[0].entryPath[1].includes('\\'));
  } finally {
    f.close();
  }
});

test('a symlinked project config is refused', async (t) => {
  const f = workspaceFixture();
  try {
    mkdirSync(path.join(f.root, '.codex'));
    const real = path.join(f.base, 'elsewhere.toml');
    writeFileSync(real, 'model = "plain"\n');
    try {
      symlinkSync(real, path.join(f.root, '.codex/config.toml'), 'file');
    } catch {
      t.skip('symbolic links unavailable');
      return;
    }
    await assert.rejects(manageAgent(f.options()), /AGENT_PATH_CONFLICT/);
    assert.equal(readFileSync(real, 'utf8'), 'model = "plain"\n');
    assert.equal(f.created.length, 0);
  } finally {
    f.close();
  }
});

test('uninstall still works after the project folder was deleted and does not recreate it', async () => {
  const f = workspaceFixture();
  try {
    await manageAgent(f.options({ target: 'codex' }));
    rmSync(f.root, { recursive: true, force: true });
    const result = await manageAgent(f.options({ target: 'codex', operation: 'uninstall' }));
    assert.deepEqual(result.registrations, []);
    assert.ok(!existsSync(f.root));
    assert.equal(f.revoked.length, 1);
  } finally {
    f.close();
  }
});
