import assert from 'node:assert/strict';
import test from 'node:test';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { manageAgent } from '../src/manage.js';
import { agentLocation } from '../src/adapters.js';
import type { AgentOptions } from '../src/types.js';

test('all four agents coexist across products, reinstall, transport switch and clean uninstall', async () => {
  const home = mkdtempSync(path.join(tmpdir(), 'aevra-agents-'));
  let serial = 0;
  const revoked: string[] = [];
  const base: AgentOptions = {
    home,
    env: {},
    product: 'aevra',
    target: 'all',
    operation: 'install',
    transport: 'stdio',
    executable: process.execPath,
    entrypoint: '/app/cli.js',
    stateDir: path.join(home, 'state/root'),
    endpoint: 'https://localhost:47832/mcp',
    credentials: {
      async create() {
        return { id: `c${++serial}`, token: `secret-${serial}` };
      },
      async revoke(id) {
        revoked.push(id);
      },
    },
  };
  try {
    const claude = agentLocation('claude-code', home, {});
    mkdirSync(path.dirname(claude.config), { recursive: true });
    writeFileSync(claude.config, '{"custom":true,"mcpServers":{"other":{"command":"other"}}}\n');
    await manageAgent(base);
    assert.equal(serial, 4);
    await manageAgent(base);
    assert.equal(serial, 4);
    assert.ok(lstatSync(path.join(home, '.claude/skills/aevra')).isSymbolicLink());
    const browser = {
      ...base,
      product: 'aevra-browser' as const,
      stateDir: path.join(home, 'state/browser'),
      endpoint: 'http://127.0.0.1:47842/mcp',
    };
    await manageAgent(browser);
    await manageAgent({ ...base, target: 'codex', transport: 'http' });
    assert.equal(revoked.length, 1);
    const status = await manageAgent({ ...base, operation: 'status' });
    assert.equal(status.registrations.length, 4);
    await manageAgent({ ...base, operation: 'uninstall' });
    assert.ok(!existsSync(path.join(home, '.agents/skills/aevra')));
    assert.ok(existsSync(path.join(home, '.agents/skills/aevra-browser/SKILL.md')));
    await manageAgent({ ...browser, operation: 'uninstall' });
    const remaining = JSON.parse(readFileSync(claude.config, 'utf8'));
    assert.equal(remaining.custom, true);
    assert.deepEqual(Object.keys(remaining.mcpServers), ['other']);
    assert.ok(!existsSync(path.join(home, '.claude/skills/aevra-browser')));
    assert.equal(revoked.length, 9);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('preflight refuses user collisions and malformed config before provisioning credentials', async () => {
  const home = mkdtempSync(path.join(tmpdir(), 'aevra-agent-conflict-'));
  let created = 0;
  const base: AgentOptions = {
    home,
    env: {},
    product: 'aevra',
    target: 'all',
    operation: 'install',
    transport: 'stdio',
    executable: process.execPath,
    entrypoint: '/cli.js',
    stateDir: path.join(home, 'state'),
    endpoint: 'https://localhost:47832/mcp',
    credentials: {
      async create() {
        created++;
        return { id: 'id', token: 'secret' };
      },
      async revoke() {},
    },
  };
  try {
    const location = agentLocation('opencode', home, {});
    mkdirSync(path.dirname(location.config), { recursive: true });
    writeFileSync(location.config, '{bad');
    await assert.rejects(manageAgent(base));
    assert.equal(created, 0);
    writeFileSync(location.config, '{"mcp":{"aevra":{"command":["custom"]}}}');
    await assert.rejects(manageAgent(base), /CONFLICT/);
    assert.equal(created, 0);
    const before = readFileSync(location.config, 'utf8');
    await assert.rejects(manageAgent({ ...base, dryRun: true }), /CONFLICT/);
    assert.equal(readFileSync(location.config, 'utf8'), before);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
