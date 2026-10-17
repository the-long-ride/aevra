import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAgentArgs } from '../src/agent-args.js';
import { agentHelpText, completionText } from '../src/cli-usage.js';
import { runAgentCommand, runRootUninstall } from '../src/commands/agent-command.js';
import { harness, parse, posts } from './agent-command-fixture.js';

const base = { command: 'agent', transport: 'stdio', dryRun: false, yes: false, json: false };

test('uninstall --id parses and refuses agent names, scope, workspace and install', () => {
  assert.deepEqual(parseAgentArgs(['uninstall', '--id', 'cred-heron-2', '--dry-run']), {
    ...base,
    action: 'uninstall',
    targets: [],
    id: 'cred-heron-2',
    dryRun: true,
  });
  const refuse = (rest: string[], pattern: RegExp) =>
    assert.throws(() => parseAgentArgs(rest), pattern);
  refuse(['uninstall', 'codex', '--id', 'cred-heron-2'], /--id cannot be combined/);
  refuse(['uninstall', 'all', '--id', 'cred-heron-2'], /--id cannot be combined/);
  refuse(['uninstall', '--id', 'cred-heron-2', '--scope', 'user'], /--id cannot be combined/);
  refuse(['uninstall', '--id', 'cred-heron-2', '--workspace', 'Demo'], /--id cannot be combined/);
  refuse(['uninstall', '--id'], /--id requires a connection id/);
  refuse(['uninstall', '--id', 'a', '--id', 'b'], /--id was given more than once/);
  refuse(['install', '--id', 'cred-heron-2'], /Unknown option: --id/);
  refuse(['list', '--id', 'cred-heron-2'], /Unknown option: --id/);
});

test('uninstall --id posts only the credential id and prints a summary', async () => {
  const { deps, calls, logs } = harness({
    post: () => ({
      body: {
        registrations: [],
        results: [{ target: 'codex', ok: true }],
        changes: [],
        notes: ['codex: workspace folder gone'],
      },
    }),
  });
  assert.equal(await runAgentCommand(parse('uninstall', '--id', 'cred-heron-2'), deps), 0);
  assert.deepEqual(posts(calls), [
    { operation: 'uninstall', credentialId: 'cred-heron-2', transport: 'stdio', dryRun: false },
  ]);
  const text = logs.join('\n');
  assert.match(text, /^Agent uninstall \(connection cred-heron-2\)/);
  assert.match(text, /ok {3} {2}codex {2}no change/);
  assert.match(text, /workspace folder gone/);
});

test('uninstall all without a scope and the root uninstall send scope all', async () => {
  const plain = harness();
  assert.equal(await runAgentCommand(parse('uninstall', 'all'), plain.deps), 0);
  const root = harness();
  const cleanup = { cleanup: async () => ({}) };
  const command = { command: 'uninstall', purge: false, dryRun: true } as const;
  assert.equal(await runRootUninstall(command, root.deps, cleanup), 0);
  assert.deepEqual(
    [...posts(plain.calls), ...posts(root.calls)].map((body) => [body.target, body.scope]),
    [
      ['all', 'all'],
      ['all', 'all'],
    ],
  );
});

test('list shows the id of a connection whose workspace is not registered, and only that', async () => {
  const { deps, logs } = harness({
    registrations: [
      { target: 'codex', scope: 'user', transport: 'stdio', credentialId: 'cred-user' },
      {
        target: 'opencode',
        scope: 'workspace',
        workspaceId: 'ws-1',
        transport: 'stdio',
        credentialId: 'cred-known',
      },
      {
        target: 'codex',
        scope: 'workspace',
        workspaceRoot: '/w/old-site',
        transport: 'stdio',
        credentialId: 'cred-heron-7',
        credentialFile: 'secret-place',
      },
    ],
  });
  assert.equal(await runAgentCommand(parse('list'), deps), 0);
  const text = logs.join('\n');
  assert.match(text, /aevra agent uninstall --id <id>/);
  assert.match(text, /codex {2}\/w\/old-site {2}cred-heron-7/);
  assert.doesNotMatch(text, /cred-user|cred-known|secret-place/);
});

test('agent help and completion name --id', () => {
  assert.match(agentHelpText(), /--id <id>/);
  assert.match(agentHelpText(), /aevra agent uninstall --id /);
  assert.match(completionText('bash'), /--id/);
});
