import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildAgentRows,
  formatAgentTable,
  formatDetectedList,
  formatInstallSummary,
  redactRegistrations,
} from '../src/commands/agent-format.js';

test('table has the documented columns and global or workspace scope', () => {
  const table = formatAgentTable([
    {
      target: 'codex',
      found: true,
      scope: 'user',
      transport: 'stdio',
      state: 'installed',
      lastUsedAt: '2026-10-01T10:20:30.000Z',
    },
    {
      target: 'opencode',
      found: false,
      scope: 'workspace',
      workspaceName: 'Demo',
      transport: 'stdio',
      state: 'conflict',
      lastUsedAt: null,
    },
    { target: 'antigravity', found: true },
  ]);
  assert.equal(
    table,
    [
      'Agent        Found  Scope   Transport  State          Last used',
      'codex        yes    global  stdio      installed      2026-10-01',
      'opencode     no     Demo    stdio      conflict       never',
      'antigravity  yes    -       -          not connected  -',
    ].join('\n'),
  );
});

test('unparseable last-used values read as never', () => {
  const table = formatAgentTable([
    { target: 'codex', found: true, scope: 'user', transport: 'stdio', lastUsedAt: 'later' },
  ]);
  assert.match(table, /installed\s+never$/);
});

test('a registration whose credential is gone reads missing, not never', () => {
  const detected = [{ target: 'codex', found: true, evidence: 'path', configPath: '/c' }];
  const base = { target: 'codex', scope: 'user' as const, transport: 'stdio', lastUsedAt: null };
  const gone = buildAgentRows(
    detected,
    [{ ...base, state: 'incomplete', connectorMissing: true }],
    new Map(),
  );
  assert.match(formatAgentTable(gone), /incomplete\s+missing$/);
  const unused = buildAgentRows(detected, [{ ...base, state: 'installed' }], new Map());
  assert.match(formatAgentTable(unused), /installed\s+never$/);
});

test('rows join detection with registrations and resolve workspace names', () => {
  const rows = buildAgentRows(
    [
      { target: 'codex', found: true, evidence: 'path', configPath: '/c' },
      { target: 'opencode', found: false, evidence: 'none', configPath: '/o' },
    ],
    [
      { target: 'codex', scope: 'user', transport: 'stdio', state: 'installed' },
      { target: 'codex', scope: 'workspace', workspaceId: 'w1', transport: 'stdio' },
      { target: 'codex', scope: 'workspace', workspaceRoot: 'C:\\work\\site', transport: 'stdio' },
      { target: 'claude-code', scope: 'user', transport: 'http', lastUsedAt: null },
    ],
    new Map([['w1', 'Demo']]),
  );
  assert.deepEqual(
    rows.map((row) => [row.target, row.found, row.scope, row.workspaceName]),
    [
      ['codex', true, 'user', undefined],
      ['codex', true, 'workspace', 'Demo'],
      ['codex', true, 'workspace', 'site'],
      ['opencode', false, undefined, undefined],
      ['claude-code', false, 'user', undefined],
    ],
  );
});

test('detected list names the evidence', () => {
  assert.equal(
    formatDetectedList([
      { target: 'codex', found: true, evidence: 'path', configPath: '/c' },
      {
        target: 'claude-code',
        found: true,
        evidence: 'config',
        configPath: '/home/u/.claude.json',
      },
    ]),
    [
      'Detected agents:',
      '  codex        on PATH',
      '  claude-code  config at /home/u/.claude.json',
    ].join('\n'),
  );
});

test('install summary lists per-target outcomes, notes and the restart line', () => {
  const summary = formatInstallSummary(
    {
      results: [
        { target: 'codex', ok: true },
        { target: 'opencode', ok: false, error: 'AGENT_CONFIG_CONFLICT: edited by hand' },
        { target: 'antigravity', ok: true },
      ],
      changes: [{ target: 'codex', file: '/h/.codex/config.toml', action: 'update' }],
      notes: ['Added the file to .git/info/exclude'],
    },
    { action: 'install', targets: ['codex'], dryRun: false },
  );
  assert.equal(
    summary,
    [
      'Agent install (global)',
      '  ok     codex        update /h/.codex/config.toml',
      '  error  opencode     AGENT_CONFIG_CONFLICT: edited by hand',
      '  ok     antigravity  no change',
      'Notes:',
      '  - Added the file to .git/info/exclude',
      'Restart or refresh the agent to apply.',
    ].join('\n'),
  );
});

test('dry run says would and nothing was written; all failures skip the restart line', () => {
  const dry = formatInstallSummary(
    {
      results: [{ target: 'codex', ok: true }],
      changes: [{ target: 'codex', file: '/w/.codex/config.toml', action: 'create' }],
    },
    { action: 'install', targets: ['codex'], workspace: 'Demo', scope: 'workspace', dryRun: true },
  );
  assert.equal(
    dry,
    [
      'Agent install (workspace Demo), dry run',
      '  ok     codex  would create /w/.codex/config.toml',
      'Dry run: nothing was written.',
    ].join('\n'),
  );
  const failed = formatInstallSummary(
    { results: [{ target: 'codex', ok: false, error: 'boom' }] },
    { action: 'uninstall', targets: ['all'], dryRun: false },
  );
  assert.equal(failed, ['Agent uninstall (all scopes)', '  error  codex  boom'].join('\n'));
});

test('a single all result lists every change', () => {
  const summary = formatInstallSummary(
    {
      results: [{ target: 'all', ok: true }],
      changes: [
        { target: 'codex', file: '/a', action: 'remove' },
        { target: 'opencode', file: '/b', action: 'remove' },
      ],
    },
    { action: 'uninstall', targets: ['all'], scope: 'user', dryRun: false },
  );
  assert.match(summary, /^Agent uninstall \(global\)\n {2}ok {5}all {2}remove \/a; remove \/b\n/);
});

test('registration credential fields are removed from JSON output', () => {
  const redacted = redactRegistrations({
    message: 'm',
    registrations: [
      { target: 'codex', credentialFile: 'f', credentialHash: 'h', credentialId: 'id' },
    ],
  });
  assert.deepEqual(redacted, {
    message: 'm',
    registrations: [{ target: 'codex', credentialId: 'id' }],
  });
  assert.deepEqual(redactRegistrations({ message: 'x' }), { message: 'x' });
});
