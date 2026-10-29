import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createAgentIntegration } from '../src/admin/agent-integration.js';

function fixture() {
  const base = mkdtempSync(path.join(tmpdir(), 'aevra-core-scope-'));
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
  const status = async () => (await run({ operation: 'status', target: 'all' })).registrations;
  return { base, home, root, revoked, run, status, close: () => rmSync(base, { recursive: true }) };
}

async function bothScopes(f: ReturnType<typeof fixture>) {
  await f.run({ operation: 'install', targets: ['codex'], scope: 'user' });
  await f.run({
    operation: 'install',
    targets: ['codex'],
    scope: 'workspace',
    workspaceRoot: f.root,
  });
  assert.equal((await f.status()).length, 2);
}

const scopes = (rows: any[]) => rows.map((row) => `${row.target}:${row.scope}`).sort();

test('an explicit user scope never sweeps workspace registrations, for target all too', async () => {
  const f = fixture();
  try {
    await bothScopes(f);
    const out = await f.run({ operation: 'uninstall', target: 'all', scope: 'user' });
    assert.ok(out.results.every((row: any) => row.ok));
    assert.deepEqual(scopes(await f.status()), ['codex:workspace']);
    assert.equal(f.revoked.length, 1);
  } finally {
    f.close();
  }
});

test('scope all removes every scope and reports one result per agent', async () => {
  const f = fixture();
  try {
    await bothScopes(f);
    const preview = await f.run({
      operation: 'uninstall',
      target: 'all',
      scope: 'all',
      dryRun: true,
    });
    assert.equal(preview.changes.length, 2);
    assert.equal((await f.status()).length, 2);
    const out = await f.run({ operation: 'uninstall', target: 'all', scope: 'all' });
    assert.deepEqual(
      out.results.map((row: any) => [row.target, row.ok]),
      ['codex', 'claude-code', 'opencode', 'antigravity', 'antigravity-cli', 'antigravity-ide'].map(
        (target) => [target, true],
      ),
    );
    assert.deepEqual(await f.status(), []);
    assert.equal(f.revoked.length, 2);
    await assert.rejects(
      f.run({ operation: 'install', targets: ['codex'], scope: 'all' }),
      /AGENT_OPTIONS_INVALID/,
    );
  } finally {
    f.close();
  }
});

test('a single-call uninstall of all continues past a failing agent', async () => {
  const f = fixture();
  try {
    await f.run({ operation: 'install', targets: ['codex', 'opencode'], scope: 'user' });
    const file = path.join(f.home, '.config', 'opencode', 'opencode.json');
    // An unreadable config stops that agent; an edited entry would only be retained.
    writeFileSync(file, '{ not valid json');
    const out = await f.run({ operation: 'uninstall', target: 'all' });
    const byTarget = Object.fromEntries(out.results.map((row: any) => [row.target, row]));
    assert.equal(byTarget.codex.ok, true);
    assert.equal(byTarget.opencode.ok, false);
    assert.match(byTarget.opencode.error, /AGENT_CONFIG_INVALID/);
    assert.deepEqual(scopes(await f.status()), ['opencode:user']);
  } finally {
    f.close();
  }
});

test('uninstall by credentialId removes an orphan whose folder is gone', async () => {
  const f = fixture();
  try {
    await bothScopes(f);
    const orphan = (await f.status()).find((row: any) => row.scope === 'workspace');
    rmSync(f.root, { recursive: true });
    const preview = await f.run({
      operation: 'uninstall',
      credentialId: orphan.credentialId,
      dryRun: true,
    });
    assert.equal((await f.status()).length, 2);
    assert.ok(preview.notes.some((note: string) => /no longer exists/.test(note)));
    const out = await f.run({ operation: 'uninstall', credentialId: orphan.credentialId });
    assert.deepEqual(
      out.results.map((row: any) => [row.target, row.ok]),
      [['codex', true]],
    );
    assert.ok(out.notes.some((note: string) => /could not be edited|cannot be edited/.test(note)));
    assert.deepEqual(scopes(await f.status()), ['codex:user']);
    assert.deepEqual(f.revoked, [orphan.credentialId]);
  } finally {
    f.close();
  }
});

test('a credentialId must name a known registration and only uninstall takes one', async () => {
  const f = fixture();
  try {
    await bothScopes(f);
    const [known] = await f.status();
    const bad: unknown[] = [
      { operation: 'uninstall', credentialId: 'not-registered' },
      { operation: 'uninstall', credentialId: '..\\agent-credentials\\codex.json' },
      { operation: 'uninstall', credentialId: '' },
      { operation: 'uninstall', credentialId: 7 },
      { operation: 'install', credentialId: known.credentialId },
      { operation: 'uninstall', credentialId: known.credentialId, targets: ['codex'] },
      { operation: 'uninstall', credentialId: known.credentialId, scope: 'workspace' },
    ];
    for (const input of bad) await assert.rejects(f.run(input), /AGENT_OPTIONS_INVALID/);
    assert.equal((await f.status()).length, 2);
    assert.deepEqual(f.revoked, []);
  } finally {
    f.close();
  }
});
