import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAevraArgs } from '../src/args.js';
import { parseAgentArgs, type AgentCliCommand } from '../src/agent-args.js';

const cmd = (rest: string[]) => parseAgentArgs(rest) as AgentCliCommand;
const base = { command: 'agent', transport: 'stdio', dryRun: false, yes: false, json: false };

test('list and its status alias parse with and without --json', () => {
  assert.deepEqual(parseAgentArgs(['list']), { ...base, action: 'list', targets: [] });
  assert.deepEqual(parseAgentArgs(['status']), { ...base, action: 'list', targets: [] });
  assert.deepEqual(parseAgentArgs(['status', '--json']), {
    ...base,
    action: 'list',
    targets: [],
    json: true,
  });
  assert.deepEqual(parseAgentArgs(['list']), parseAgentArgs(['status']));
});

test('install parses targets, the claude alias, all and duplicates', () => {
  assert.deepEqual(parseAgentArgs(['install']), { ...base, action: 'install', targets: [] });
  assert.deepEqual(parseAgentArgs(['install', 'codex', 'claude', 'claude-code', 'opencode']), {
    ...base,
    action: 'install',
    targets: ['codex', 'claude-code', 'opencode'],
  });
  assert.deepEqual(cmd(['install', 'all']).targets, ['all']);
  assert.deepEqual(cmd(['install', 'antigravity']).targets, ['antigravity']);
});

test('install parses every flag', () => {
  assert.deepEqual(
    parseAgentArgs(['install', 'codex', '--transport', 'http', '--dry-run', '--yes', '--json']),
    {
      ...base,
      action: 'install',
      targets: ['codex'],
      transport: 'http',
      dryRun: true,
      yes: true,
      json: true,
    },
  );
  assert.equal(cmd(['install', '--scope', 'user']).scope, 'user');
});

test('--workspace implies workspace scope, --scope workspace needs a workspace', () => {
  assert.deepEqual(parseAgentArgs(['install', 'codex', '--workspace', 'Demo']), {
    ...base,
    action: 'install',
    targets: ['codex'],
    scope: 'workspace',
    workspace: 'Demo',
  });
  assert.deepEqual(
    cmd(['install', 'codex', '--scope', 'workspace', '--workspace', 'Demo']).scope,
    'workspace',
  );
  assert.throws(
    () => parseAgentArgs(['install', 'codex', '--scope', 'workspace']),
    /--scope workspace requires --workspace/,
  );
  assert.throws(
    () => parseAgentArgs(['install', 'codex', '--scope', 'user', '--workspace', 'Demo']),
    /cannot be combined/,
  );
});

test('http transport is refused with workspace scope', () => {
  assert.throws(
    () => parseAgentArgs(['install', 'codex', '--workspace', 'Demo', '--transport', 'http']),
    /--transport http cannot be used with workspace scope/,
  );
});

test('uninstall parses targets, scope, workspace and dry-run', () => {
  assert.deepEqual(parseAgentArgs(['uninstall', 'all', '--dry-run']), {
    ...base,
    action: 'uninstall',
    targets: ['all'],
    dryRun: true,
  });
  assert.deepEqual(parseAgentArgs(['uninstall', 'claude', '--workspace', 'Demo']), {
    ...base,
    action: 'uninstall',
    targets: ['claude-code'],
    scope: 'workspace',
    workspace: 'Demo',
  });
  assert.throws(() => parseAgentArgs(['uninstall']), /requires an agent name, all or --id/);
});

test('errors name the problem: unknown flags, values and commands', () => {
  assert.throws(() => parseAgentArgs(['install', '--wat']), /Unknown option: --wat/);
  assert.throws(() => parseAgentArgs(['list', '--dry-run']), /Unknown option: --dry-run/);
  assert.throws(() => parseAgentArgs(['uninstall', 'codex', '--yes']), /Unknown option: --yes/);
  assert.throws(
    () => parseAgentArgs(['uninstall', 'codex', '--transport', 'http']),
    /Unknown option: --transport/,
  );
  assert.throws(() => parseAgentArgs(['install', '--transport', 'ftp']), /stdio or http/);
  assert.throws(() => parseAgentArgs(['install', '--transport']), /stdio or http/);
  assert.throws(() => parseAgentArgs(['install', '--scope', 'team']), /user or workspace/);
  assert.throws(() => parseAgentArgs(['install', '--workspace']), /workspace name or id/);
  assert.throws(() => parseAgentArgs(['install', 'vim']), /Unknown agent: vim/);
  assert.throws(() => parseAgentArgs(['list', 'codex']), /takes no agent names/);
  assert.throws(() => parseAgentArgs(['frobnicate']), /Unknown agent command: frobnicate/);
  assert.throws(() => parseAgentArgs(['serve']), /internal/);
});

test('help is requested with no arguments, help or --help anywhere', () => {
  for (const rest of [[], ['help'], ['--help'], ['-h'], ['install', '--help']]) {
    assert.deepEqual(parseAgentArgs(rest), { command: 'agent-help' });
  }
});

test('parseAevraArgs routes agent and the root uninstall', () => {
  assert.deepEqual(parseAevraArgs(['agent', 'status']), {
    ...base,
    action: 'list',
    targets: [],
  });
  assert.deepEqual(parseAevraArgs(['agent']), { command: 'agent-help' });
  assert.deepEqual(parseAevraArgs(['uninstall']), {
    command: 'uninstall',
    purge: false,
    dryRun: false,
  });
  assert.deepEqual(parseAevraArgs(['uninstall', '--purge', '--dry-run']), {
    command: 'uninstall',
    purge: true,
    dryRun: true,
  });
  assert.throws(() => parseAevraArgs(['uninstall', '--all']), /Unknown option: --all/);
});

test('repeated flags, mixed targets and the = forms are refused', () => {
  const refuse = (rest: string[], pattern: RegExp) =>
    assert.throws(() => parseAgentArgs(rest), pattern);
  refuse(
    ['install', 'codex', '--workspace', 'A', '--workspace', 'B'],
    /--workspace was given more than once/,
  );
  refuse(
    ['install', 'codex', '--scope', 'user', '--scope', 'workspace', '--workspace', 'A'],
    /--scope was given more than once/,
  );
  refuse(
    ['install', 'codex', '--scope', 'workspace', '--scope', 'user', '--workspace', 'A'],
    /--scope was given more than once/,
  );
  refuse(['install', 'codex', 'all'], /all cannot be combined with named agents/);
  refuse(['uninstall', 'all', 'claude'], /all cannot be combined with named agents/);
  refuse(['install', 'codex', '--scope=workspace'], /Unknown option: --scope=workspace/);
  refuse(['install', 'codex', '--workspace=Demo'], /Unknown option: --workspace=Demo/);
  assert.deepEqual(cmd(['install', 'codex', 'codex']).targets, ['codex']);
});
