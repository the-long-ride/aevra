import assert from 'node:assert/strict';
import test from 'node:test';
import { presentApproval } from '../src/approvals/request-presentation.js';

function ticket(overrides: any = {}) {
  return {
    id: 'req_1',
    actor: 'oauth:ChatGPT',
    sessionId: 'ses_1',
    workspaceId: 'ws_1',
    operation: { family: 'command:run', capability: 'commands.run', risk: 'HIGH', argsHash: 'x' },
    payload: {},
    expectedState: {},
    risk: 'HIGH',
    state: 'PENDING',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    ...overrides,
  };
}

test('capability request describes original file command git and process intents', () => {
  const originals = [
    { tool: 'file_create', args: { path: '/new.txt' }, expected: /create \/new\.txt/ },
    { tool: 'file_patch', args: { path: '/edit.txt' }, expected: /patch \/edit\.txt/ },
    { tool: 'file_move', args: { from: '/a', to: '/b' }, expected: /move \/a → \/b/ },
    { tool: 'file_delete', args: { path: '/gone' }, expected: /delete \/gone/ },
    {
      tool: 'command_run',
      args: { command: { executable: 'npm', args: ['test'] } },
      expected: /run npm test/,
    },
    { tool: 'shell_run', args: { script: 'echo hello' }, expected: /run shell: echo hello/ },
    { tool: 'git_commit', args: { message: 'message' }, expected: /git commit: message/ },
    { tool: 'git_push', args: {}, expected: /git push origin\/current/ },
    {
      tool: 'process_start',
      args: { executable: 'node', args: ['app.js'] },
      expected: /start process node app\.js/,
    },
    { tool: 'custom_tool', args: {}, expected: /custom_tool/ },
  ];
  for (const original of originals) {
    const view = presentApproval(
      ticket({
        payload: {
          tool: 'capability_request',
          requestedCapability: 'commands.run',
          permissionMatcher: '*',
          original,
        },
      }),
    );
    assert.match(view.preview ?? '', original.expected);
  }

  const noAdded = presentApproval(
    ticket({
      payload: {
        tool: 'workspace_capability_upgrade',
        profileId: '',
        workspaceId: '',
        addedCapabilities: 'not-an-array',
      },
    }),
  );
  assert.equal(noAdded.action, 'Grant coding profile');
  assert.equal(noAdded.preview, undefined);

  const shellFallback = presentApproval(
    ticket({
      operation: {
        family: 'shell:powershell',
        capability: 'commands.run',
        risk: 'HIGH',
        argsHash: 'x',
      },
      payload: { command: { args: ['-Command', 'Write-Output ok'] }, executionMode: 'host' },
    }),
  );
  assert.equal(shellFallback.action, 'Run powershell');
  assert.equal(shellFallback.target, 'Host workspace');
  assert.match(shellFallback.preview ?? '', /Write-Output ok/);
});

test('approval presentation covers empty and default fallback branches', () => {
  const views = [
    presentApproval(ticket({ operation: { capability: 'files.read' }, payload: null })),
    presentApproval(ticket({ operation: { family: 'workspace:select' }, payload: {} })),
    presentApproval(ticket({ operation: { family: 'skills:read' }, payload: {} })),
    presentApproval(
      ticket({ operation: { family: 'files:delete' }, payload: { path: '/fallback-delete' } }),
    ),
    presentApproval(
      ticket({ operation: { family: 'files:write' }, payload: { path: '/fallback-write' } }),
    ),
    presentApproval(ticket({ payload: { tool: 'file_patch', args: {} } })),
    presentApproval(ticket({ payload: { tool: 'file_move', args: {} } })),
    presentApproval(ticket({ operation: { family: 'git:push' }, payload: { args: {} } })),
    presentApproval(ticket({ operation: { family: 'git:commit' }, payload: { args: {} } })),
    presentApproval(ticket({ operation: { family: 'change:rollback' }, payload: { args: {} } })),
    presentApproval(ticket({ payload: { tool: 'process_start', args: { command: {} } } })),
    presentApproval(
      ticket({ operation: { family: 'shell:' }, payload: { command: { args: 'not-array' } } }),
    ),
    presentApproval(ticket({ payload: { tool: 'command_run', args: {}, command: {} } })),
    presentApproval(
      ticket({
        actor: null,
        workspaceId: '',
        operation: { family: '', capability: '' },
        payload: {},
      }),
    ),
  ];
  assert.equal(views[0].title, 'Operation approval');
  assert.equal(views[1].target, 'ws_1');
  assert.equal(views[3].target, '/fallback-delete');
  assert.equal(views[4].target, '/fallback-write');
  assert.equal(views[5].target, 'workspace path');
  assert.match(views[6].target, /→/);
  assert.equal(views[7].target, 'origin/current branch');
  assert.equal(views[8].preview, '');
  assert.equal(views[9].target, 'change set');
  assert.equal(views[10].preview, '');
  assert.equal(views[11].action, 'Run shell');
  assert.equal(views[11].target, 'Strict sandbox');
  assert.equal(views[11].preview, undefined);
  assert.equal(views[12].preview, '');
  assert.equal(views[13].action, 'Operation');
  assert.equal(views[13].target, 'Aevra');

  const originalFallbacks = [
    { tool: 'file_write', args: {} },
    { tool: 'file_move', args: {} },
    { tool: 'file_delete', args: {} },
    { tool: 'file_read', args: {} },
    { tool: 'file_search', args: {} },
    { tool: 'command_run', args: { executable: 'node', args: 'bad' } },
    { tool: 'shell_run', args: {} },
    { tool: 'git_commit', args: {} },
    { tool: 'git_push', args: { remote: 'upstream' } },
    { tool: 'git_push', args: { branch: 'feature' } },
    { tool: 'process_start', args: { command: {} } },
  ];
  for (const original of originalFallbacks) {
    const view = presentApproval(
      ticket({ payload: { tool: 'capability_request', permissionMatcher: 'matcher', original } }),
    );
    assert.ok(view.preview?.includes('Requested by:'));
    assert.ok(view.preview?.includes('Matcher: matcher'));
  }
  const noIntent = presentApproval(
    ticket({ actor: null, payload: { tool: 'capability_request', original: null } }),
  );
  assert.equal(noIntent.title, 'AI client requests commands.run');
  assert.equal(noIntent.preview, undefined);
});
