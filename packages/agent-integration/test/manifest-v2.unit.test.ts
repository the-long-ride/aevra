import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { manageAgent } from '../src/manage.js';
import { agentLocation } from '../src/adapters.js';
import { configEntry, editConfig } from '../src/config-edit.js';
import { manifestFixture } from './manifest-fixture.js';

const fixture = manifestFixture;

test('a v1 manifest loads and every registration becomes user scope', async () => {
  const f = fixture();
  try {
    f.save(1, [f.reg()]);
    const status = await manageAgent(f.options);
    assert.equal(status.registrations.length, 1);
    assert.equal(status.registrations[0].scope, 'user');
    assert.deepEqual(status.registrations[0].entryPath, ['mcp_servers']);
  } finally {
    f.close();
  }
});

test('a v2 manifest may hold the same target in user and workspace scope', async () => {
  const f = fixture();
  const root = path.join(f.home, 'work/alpha');
  try {
    const workspace = f.reg({
      scope: 'workspace',
      workspaceRoot: root,
      config: agentLocation('codex', f.home, {}, 'workspace', root).config,
      entryPath: ['mcp_servers'],
      credentialFile: path.join(f.home, 'state/agent-credentials/codex-two.json'),
    });
    f.save(2, [f.reg({ scope: 'user', entryPath: ['mcp_servers'] }), workspace]);
    const status = await manageAgent(f.options);
    assert.deepEqual(
      status.registrations.map((reg) => reg.scope),
      ['user', 'workspace'],
    );
  } finally {
    f.close();
  }
});

test('two workspaces of the same target are distinct registrations', async () => {
  const f = fixture();
  try {
    const at = (name: string) => {
      const root = path.join(f.home, 'work', name);
      return f.reg({
        scope: 'workspace',
        workspaceRoot: root,
        config: agentLocation('codex', f.home, {}, 'workspace', root).config,
        entryPath: ['mcp_servers'],
      });
    };
    f.save(2, [at('alpha'), at('bravo')]);
    const status = await manageAgent(f.options);
    assert.equal(status.registrations.length, 2);
  } finally {
    f.close();
  }
});

test('duplicate (target, scope, workspaceRoot) registrations are refused', async () => {
  const f = fixture();
  try {
    const user = f.reg({ scope: 'user', entryPath: ['mcp_servers'] });
    f.save(2, [user, user]);
    await assert.rejects(manageAgent(f.options), /AGENT_MANIFEST_INVALID/);
    f.save(1, [f.reg(), f.reg()]);
    await assert.rejects(manageAgent(f.options), /AGENT_MANIFEST_INVALID/);
  } finally {
    f.close();
  }
});

test('a registration whose config path is wrong for its scope is refused', async () => {
  const f = fixture();
  try {
    f.save(2, [
      f.reg({ scope: 'workspace', workspaceRoot: path.join(f.home, 'work/alpha'), entryPath: [] }),
    ]);
    await assert.rejects(manageAgent(f.options), /AGENT_MANIFEST_INVALID/);
    f.save(2, [f.reg({ scope: 'workspace', entryPath: ['mcp_servers'] })]);
    await assert.rejects(manageAgent(f.options), /AGENT_MANIFEST_INVALID/);
    f.save(3, [f.reg()]);
    await assert.rejects(manageAgent(f.options), /AGENT_MANIFEST_INVALID/);
  } finally {
    f.close();
  }
});

test('a fresh user install writes a v2 manifest with scope and entryPath', async () => {
  const f = fixture();
  try {
    await manageAgent({ ...f.options, operation: 'install', target: 'claude-code' });
    const status = await manageAgent(f.options);
    assert.equal(status.registrations[0].scope, 'user');
    assert.deepEqual(status.registrations[0].entryPath, ['mcpServers']);
    const raw = JSON.parse(readFileSync(path.join(f.home, '.agents/aevra/aevra.json'), 'utf8'));
    assert.equal(raw.version, 2);
    assert.equal(raw.registrations[0].scope, 'user');
  } finally {
    f.close();
  }
});

test('editConfig creates nested parents and later removes only its entry', () => {
  const entryPath = ['projects', 'F:/x', 'mcpServers'];
  const created = editConfig('{}', 'json', entryPath, 'aevra', { command: 'tool' });
  assert.deepEqual(JSON.parse(created).projects['F:/x'].mcpServers, { aevra: { command: 'tool' } });
  assert.deepEqual(configEntry(created, 'json', entryPath, 'aevra'), { command: 'tool' });
  assert.equal(configEntry('{}', 'json', entryPath, 'aevra'), undefined);
  const removed = editConfig(created, 'json', entryPath, 'aevra');
  assert.equal(configEntry(removed, 'json', entryPath, 'aevra'), undefined);
});

test('editConfig keeps JSONC comments and neighbouring projects on add and remove', () => {
  const entryPath = ['projects', 'F:/x', 'mcpServers'];
  const source = [
    '{',
    '  // keep me',
    '  "projects": {',
    '    "F:/y": { "mcpServers": { "aevra-browser": { "command": "keep" } } }, // trailing note',
    '  },',
    '  "theme": "plain",',
    '}',
    '',
  ].join('\n');
  const added = editConfig(source, 'jsonc', entryPath, 'aevra', { command: 'tool' });
  assert.match(added, /\/\/ keep me/);
  assert.match(added, /\/\/ trailing note/);
  const removed = editConfig(added, 'jsonc', entryPath, 'aevra');
  assert.match(removed, /\/\/ keep me/);
  assert.match(removed, /\/\/ trailing note/);
  assert.equal(configEntry(removed, 'jsonc', entryPath, 'aevra'), undefined);
  assert.deepEqual(
    configEntry(removed, 'jsonc', ['projects', 'F:/y', 'mcpServers'], 'aevra-browser'),
    {
      command: 'keep',
    },
  );
  assert.match(removed, /"theme": "plain"/);
});

test('configEntry refuses a non-object parent and TOML refuses a nested path', () => {
  assert.throws(
    () =>
      configEntry('{"projects":{"F:/x":[]}}', 'json', ['projects', 'F:/x', 'mcpServers'], 'aevra'),
    /AGENT_CONFIG_INVALID/,
  );
  assert.throws(
    () => editConfig('', 'toml', ['a', 'b'], 'aevra', { command: 'tool' }),
    /AGENT_CONFIG_INVALID/,
  );
  assert.throws(() => configEntry('', 'toml', ['a', 'b'], 'aevra'), /AGENT_CONFIG_INVALID/);
  const toml = editConfig('model = "plain"\n', 'toml', ['mcp_servers'], 'aevra', {
    command: 'tool',
  });
  assert.deepEqual(
    { ...(configEntry(toml, 'toml', ['mcp_servers'], 'aevra') as object) },
    { command: 'tool' },
  );
});
