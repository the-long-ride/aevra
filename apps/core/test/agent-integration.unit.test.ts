import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createAgentIntegration } from '../src/admin/agent-integration.js';

function fixture() {
  const base = mkdtempSync(path.join(tmpdir(), 'aevra-core-agents-'));
  const home = path.join(base, 'home');
  const root = path.join(base, 'project');
  mkdirSync(home);
  mkdirSync(root);
  const created: string[] = [];
  const revoked: string[] = [];
  const run = createAgentIntegration(
    { stateDir: path.join(home, 'state'), mcpPort: 47832 } as any,
    {
      async create(name) {
        created.push(name);
        return { id: `cred-heron-${created.length}`, token: 'pelican' };
      },
      async revoke(id) {
        revoked.push(id);
      },
    },
    home,
    {},
  ) as (input: unknown) => Promise<any>;
  return {
    base,
    home,
    root,
    created,
    revoked,
    run,
    close: () => rmSync(base, { recursive: true, force: true }),
  };
}

const workspaceInput = (root: string, extra: Record<string, unknown> = {}) => ({
  operation: 'install',
  scope: 'workspace',
  workspaceRoot: root,
  transport: 'stdio',
  ...extra,
});

test('detect returns one entry per agent and finds a config home', async () => {
  const f = fixture();
  try {
    mkdirSync(path.join(f.home, '.codex'));
    const list = await f.run({ operation: 'detect' });
    assert.deepEqual(
      list.map((row: any) => row.target),
      ['codex', 'claude-code', 'opencode', 'antigravity', 'antigravity-cli', 'antigravity-ide'],
    );
    const codex = list.find((row: any) => row.target === 'codex');
    assert.equal(codex.found, true);
    assert.equal(codex.evidence, 'config');
    assert.equal(list.find((row: any) => row.target === 'opencode').found, false);
  } finally {
    f.close();
  }
});

test('several targets run independently and a conflict does not block the others', async () => {
  const f = fixture();
  try {
    writeFileSync(path.join(f.root, 'opencode.json'), '{"mcp":{"aevra":{"command":["custom"]}}}');
    const out = await f.run(workspaceInput(f.root, { targets: ['codex', 'opencode'] }));
    assert.deepEqual(
      out.results.map((row: any) => [row.target, row.ok]),
      [
        ['codex', true],
        ['opencode', false],
      ],
    );
    assert.ok(out.results[0].message);
    assert.equal(out.results[0].error, undefined);
    assert.match(out.results[1].error, /CONFLICT/);
    assert.equal(out.results[1].message, undefined);
    assert.deepEqual(
      out.registrations.map((row: any) => [row.target, row.scope]),
      [['codex', 'workspace']],
    );
    assert.equal(out.changes.length, 1);
    assert.equal(out.changes[0].target, 'codex');
    assert.ok(Array.isArray(out.notes));
    assert.equal(f.created.length, 1);
  } finally {
    f.close();
  }
});

test('all targets failing still returns per-target results without throwing', async () => {
  const f = fixture();
  try {
    writeFileSync(path.join(f.root, 'opencode.json'), '{"mcp":{"aevra":{"command":["custom"]}}}');
    const out = await f.run(workspaceInput(f.root, { targets: ['opencode'] }));
    assert.equal(out.results.length, 1);
    assert.equal(out.results[0].ok, false);
    assert.deepEqual(out.registrations, []);
    assert.deepEqual(out.changes, []);
  } finally {
    f.close();
  }
});

test('dry run lists changes per target and writes nothing', async () => {
  const f = fixture();
  try {
    const out = await f.run(
      workspaceInput(f.root, { targets: ['codex', 'antigravity'], dryRun: true }),
    );
    assert.equal(out.dryRun, true);
    assert.deepEqual(
      out.results.map((row: any) => row.ok),
      [true, true],
    );
    assert.deepEqual(
      out.changes.map((row: any) => row.target),
      ['codex', 'antigravity'],
    );
    assert.equal(f.created.length, 0);
    assert.deepEqual((await f.run({ operation: 'status', target: 'all' })).registrations, []);
  } finally {
    f.close();
  }
});

test('uninstall removes only the matching workspace registrations', async () => {
  const f = fixture();
  try {
    await f.run(workspaceInput(f.root, { targets: ['codex', 'antigravity'] }));
    const out = await f.run(workspaceInput(f.root, { operation: 'uninstall', targets: ['codex'] }));
    assert.equal(out.results[0].ok, true);
    assert.deepEqual(
      out.registrations.map((row: any) => row.target),
      ['antigravity'],
    );
    assert.equal(f.revoked.length, 1);
    const status = await f.run({ operation: 'status', target: 'all' });
    assert.equal(status.registrations[0].state, 'installed');
  } finally {
    f.close();
  }
});

test('a single target keeps the old behaviour: one call, errors thrown, one result entry', async () => {
  const f = fixture();
  try {
    const out = await f.run(workspaceInput(f.root, { target: 'codex' }));
    assert.deepEqual(
      out.results.map((row: any) => [row.target, row.ok]),
      [['codex', true]],
    );
    assert.equal(out.registrations.length, 1);
    writeFileSync(path.join(f.root, 'opencode.json'), '{"mcp":{"aevra":{"command":["custom"]}}}');
    await assert.rejects(f.run(workspaceInput(f.root, { target: 'opencode' })), /CONFLICT/);
  } finally {
    f.close();
  }
});

test('invalid input still throws AGENT_OPTIONS_INVALID', async () => {
  const f = fixture();
  try {
    const bad: unknown[] = [
      null,
      { operation: 'install' },
      { operation: 'purge', target: 'codex' },
      { operation: 'install', target: 'nope' },
      { operation: 'install', targets: [] },
      { operation: 'install', targets: 'codex' },
      { operation: 'install', targets: ['codex', 'nope'] },
      { operation: 'install', target: 'codex', transport: 'pipe' },
      { operation: 'install', target: 'codex', dryRun: 'yes' },
      { operation: 'install', target: 'codex', scope: 'team' },
      workspaceInput(f.root, { target: 'codex', transport: 'http' }),
      { operation: 'install', target: 'codex', scope: 'workspace' },
      workspaceInput('', { target: 'codex' }),
    ];
    for (const input of bad) await assert.rejects(f.run(input), /AGENT_OPTIONS_INVALID/);
    assert.equal(f.created.length, 0);
  } finally {
    f.close();
  }
});
