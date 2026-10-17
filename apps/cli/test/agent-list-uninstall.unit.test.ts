import assert from 'node:assert/strict';
import test from 'node:test';
import { runAgentCommand, runRootUninstall } from '../src/commands/agent-command.js';
import { harness, parse, posts } from './agent-command-fixture.js';

test('list prints detected agents with their connections', async () => {
  const { deps, logs, calls } = harness({
    registrations: [
      {
        target: 'codex',
        scope: 'user',
        transport: 'stdio',
        state: 'installed',
        lastUsedAt: '2026-10-02T00:00:00.000Z',
        credentialFile: 'secret-place',
        credentialHash: 'secret-hash',
      },
      { target: 'opencode', scope: 'workspace', workspaceId: 'ws-1', transport: 'stdio' },
    ],
  });
  assert.equal(await runAgentCommand(parse('list'), deps), 0);
  assert.equal(posts(calls).length, 0);
  const text = logs.join('\n');
  assert.match(text, /^Agent {8}Found {2}Scope {3}Transport {2}State {10}Last used\n/);
  assert.match(text, /codex {8}yes {4}global {2}stdio {6}installed {6}2026-10-02/);
  assert.match(text, /opencode {5}yes {4}Demo {4}stdio {6}installed {6}never/);
  assert.match(text, /claude-code {2}no {5}- {7}- {10}not connected {2}-/);
  assert.doesNotMatch(text, /secret/);
});

test('list --json prints detection and registrations without credential fields', async () => {
  const { deps, logs } = harness({
    registrations: [{ target: 'codex', credentialFile: 'f', credentialHash: 'h', scope: 'user' }],
  });
  assert.equal(await runAgentCommand(parse('list', '--json'), deps), 0);
  const body = JSON.parse(logs[0]!);
  assert.equal(body.detected.length, 4);
  assert.deepEqual(body.registrations, [{ target: 'codex', scope: 'user' }]);
});

test('list falls back when workspaces cannot be read', async () => {
  const { deps, logs } = harness({
    registrations: [
      { target: 'codex', scope: 'workspace', workspaceRoot: '/w/site', transport: 'stdio' },
    ],
  });
  deps.workspaces = async () => {
    throw new Error('offline');
  };
  assert.equal(await runAgentCommand(parse('list'), deps), 0);
  assert.match(logs.join('\n'), /codex {8}yes {4}site/);
});

test('root uninstall removes every agent link, then cleans up', async () => {
  const { deps, calls, logs } = harness();
  const cleanup: Array<[boolean, boolean]> = [];
  const code = await runRootUninstall({ command: 'uninstall', purge: true, dryRun: false }, deps, {
    async cleanup(purge, dryRun) {
      cleanup.push([purge, dryRun]);
      return { message: 'Cleanup finished.' };
    },
  });
  assert.equal(code, 0);
  assert.deepEqual(posts(calls), [
    { operation: 'uninstall', target: 'all', scope: 'all', transport: 'stdio', dryRun: false },
  ]);
  assert.deepEqual(cleanup, [[true, false]]);
  assert.match(logs.join('\n'), /Agent uninstall \(all scopes\)[\s\S]*Cleanup finished\.$/);
});

test('root uninstall stops before cleanup when the agent removal fails', async () => {
  const { deps, errors } = harness({
    post: () => ({ status: 500, body: { error: { code: 'X', message: 'broken' } } }),
  });
  let cleaned = false;
  const code = await runRootUninstall({ command: 'uninstall', purge: false, dryRun: false }, deps, {
    async cleanup() {
      cleaned = true;
      return {};
    },
  });
  assert.equal(code, 1);
  assert.equal(cleaned, false);
  assert.match(errors[0]!, /^\[aevra\] uninstall failed: X: broken/);
});

test('root uninstall against an older core skips cleanup unless it answered with a message', async () => {
  const cleaned: boolean[] = [];
  const root = {
    async cleanup() {
      cleaned.push(true);
      return {};
    },
  };
  const command = { command: 'uninstall', purge: true, dryRun: false } as const;
  const bare = harness({ post: () => ({ body: {} }) });
  assert.equal(await runRootUninstall(command, bare.deps, root), 1);
  assert.deepEqual(cleaned, []);
  assert.match(bare.errors.join('\n'), /older than this CLI/);
  const said = harness({ post: () => ({ body: { message: 'done' } }) });
  assert.equal(await runRootUninstall(command, said.deps, root), 0);
  assert.deepEqual(said.logs, ['done']);
  assert.deepEqual(cleaned, [true]);
});
