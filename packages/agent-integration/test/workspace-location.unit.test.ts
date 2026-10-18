import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { agentLocation } from '../src/adapters.js';
import { foldsCase } from '../src/claude-project-key.js';

function withHome<T>(run: (home: string, root: string) => T): T {
  const home = mkdtempSync(path.join(tmpdir(), 'aevra-location-'));
  try {
    return run(home, path.join(home, 'work', 'alpha'));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

test("user scope keeps today's paths and a one-element entry path", () =>
  withHome((home) => {
    const codex = agentLocation('codex', home, {});
    assert.equal(codex.config, path.join(home, '.codex', 'config.toml'));
    assert.deepEqual(codex.entryPath, ['mcp_servers']);
    assert.equal(agentLocation('codex', home, {}, 'user').config, codex.config);
    assert.deepEqual(agentLocation('claude-code', home, {}).entryPath, ['mcpServers']);
    assert.deepEqual(agentLocation('opencode', home, {}).entryPath, ['mcp']);
    assert.deepEqual(agentLocation('antigravity', home, {}).entryPath, ['mcpServers']);
    assert.ok(agentLocation('claude-code', home, {}).skills.length > 0);
  }));

test('workspace scope puts codex, opencode and antigravity entries under the root', () =>
  withHome((home, root) => {
    const codex = agentLocation('codex', home, {}, 'workspace', root);
    assert.equal(codex.config, path.join(root, '.codex', 'config.toml'));
    assert.equal(codex.kind, 'toml');
    assert.deepEqual(codex.entryPath, ['mcp_servers']);
    assert.deepEqual(codex.skills, []);
    const opencode = agentLocation('opencode', home, {}, 'workspace', root);
    assert.equal(opencode.config, path.join(root, 'opencode.json'));
    assert.equal(opencode.kind, 'jsonc');
    assert.deepEqual(opencode.entryPath, ['mcp']);
    assert.deepEqual(opencode.skills, []);
    const anti = agentLocation('antigravity', home, {}, 'workspace', root);
    assert.equal(anti.config, path.join(root, '.agents', 'mcp_config.json'));
    assert.equal(anti.kind, 'json');
    assert.deepEqual(anti.entryPath, ['mcpServers']);
    assert.deepEqual(anti.skills, []);
  }));

test('workspace opencode uses an existing opencode.jsonc', () =>
  withHome((home, root) => {
    mkdirSync(root, { recursive: true });
    writeFileSync(path.join(root, 'opencode.jsonc'), '{}\n');
    const opencode = agentLocation('opencode', home, {}, 'workspace', root);
    assert.equal(opencode.config, path.join(root, 'opencode.jsonc'));
  }));

test('workspace claude-code lives in the user file under projects and reuses an existing key', () =>
  withHome((home, root) => {
    const fresh = agentLocation('claude-code', home, {}, 'workspace', root);
    assert.equal(fresh.config, path.join(home, '.claude.json'));
    assert.equal(fresh.kind, 'json');
    assert.deepEqual(fresh.entryPath, ['projects', root.replaceAll('\\', '/'), 'mcpServers']);
    assert.deepEqual(fresh.skills, []);
    const existing = root.replaceAll('\\', '/').toUpperCase();
    writeFileSync(fresh.config, JSON.stringify({ projects: { [existing]: { mcpServers: {} } } }));
    const reused = agentLocation('claude-code', home, {}, 'workspace', root);
    // Case is ignored only where file systems usually ignore it (win32, darwin); elsewhere the
    // upper-case key names another folder and the exact key is used.
    const expected = foldsCase() ? existing : root.replaceAll('\\', '/');
    assert.deepEqual(reused.entryPath, ['projects', expected, 'mcpServers']);
    const custom = agentLocation(
      'claude-code',
      home,
      { CLAUDE_CONFIG_DIR: home },
      'workspace',
      root,
    );
    assert.equal(custom.config, path.join(home, '.claude.json'));
  }));

test('workspace scope without a root is refused', () =>
  withHome((home) => {
    assert.throws(() => agentLocation('codex', home, {}, 'workspace'), /AGENT_OPTIONS_INVALID/);
  }));
