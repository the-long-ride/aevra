import assert from 'node:assert/strict';
import test from 'node:test';
import { presentApproval } from '../src/approvals/request-presentation.js';

function ticket(overrides: Record<string, unknown> = {}): any {
  return {
    id: 'req_1',
    actor: 'oauth:ChatGPT',
    sessionId: 's',
    workspaceId: 'ws-1',
    operation: { family: 'unknown:op', capability: 'files.read', risk: 'LOW', argsHash: 'h' },
    expectedState: {},
    risk: 'LOW',
    state: 'PENDING',
    expiresAt: '2030-01-01T00:00:00.000Z',
    ...overrides,
  };
}

test('host control requests describe browser vs desktop access and fall back to the actor', () => {
  const browser = presentApproval(
    ticket({ scope: 'host', operation: { family: 'host-control:request', capability: 'browser.control' } }),
  );
  assert.deepEqual(browser, {
    title: 'Host control access',
    action: 'Grant browser control',
    target: 'oauth:ChatGPT',
    preview: 'Persistent access for this exact connection until revoked',
  });
  const desktop = presentApproval(
    ticket({
      scope: 'host',
      identity: { kind: 'session', key: 'connection-a' },
      operation: { family: 'host-control:request', capability: 'desktop.control' },
    }),
  );
  assert.equal(desktop.action, 'Grant desktop control');
  assert.equal(desktop.target, 'connection-a');
});

test('host actions name the tool, family, or a generic host action', () => {
  const browserAction = presentApproval(
    ticket({ scope: 'host', payload: { tool: 'browser_click' }, operation: { family: 'browser:click', capability: 'browser.control' } }),
  );
  assert.equal(browserAction.title, 'Browser action approval');
  assert.equal(browserAction.action, 'Allow browser_click');
  const desktopFamily = presentApproval(
    ticket({ scope: 'host', identity: { key: 'k' }, operation: { family: 'desktop:type', capability: 'desktop.control' } }),
  );
  assert.equal(desktopFamily.title, 'Desktop action approval');
  assert.equal(desktopFamily.action, 'Allow desktop:type');
  const generic = presentApproval(ticket({ scope: 'host', operation: {} }));
  assert.equal(generic.action, 'Allow host action');
  assert.equal(generic.title, 'Desktop action approval');
});

test('capability upgrades list added capabilities only when present', () => {
  const withAdded = presentApproval(
    ticket({
      payload: { tool: 'workspace_capability_upgrade', profileId: 'developer', workspaceId: 'ws-2', addedCapabilities: ['files.write', '', 'commands.run'] },
    }),
  );
  assert.deepEqual(withAdded, {
    title: 'Enable coding access',
    action: 'Grant developer',
    target: 'ws-2',
    preview: 'Adds: files.write, commands.run',
  });
  const bare = presentApproval(
    ticket({ operation: { family: 'workspace:capability-upgrade' }, payload: { addedCapabilities: 'files.write' } }),
  );
  assert.deepEqual(bare, { title: 'Enable coding access', action: 'Grant coding profile', target: 'ws-1' });
});

test('capability requests fall back to operation capability and a generic actor label', () => {
  const view = presentApproval(
    ticket({ actor: 'connector:', operation: { family: 'x', capability: 'git.push' }, payload: { tool: 'capability_request' } }),
  );
  assert.deepEqual(view, { title: 'AI client requests git.push', action: 'Grant git.push', target: 'Workspace ws-1' });
  const missingActor = presentApproval(ticket({ actor: undefined, payload: { tool: 'capability_request', requestedCapability: 'files.read' } }));
  assert.equal(missingActor.title, 'AI client requests files.read');
});

test('capability request previews describe each original tool intent', () => {
  const intent = (tool: string, args: Record<string, unknown> = {}) =>
    presentApproval(ticket({ payload: { tool: 'capability_request', requestedCapability: 'c', original: { tool, args } } })).preview;
  assert.equal(intent('file_create'), 'Requested by: create workspace file');
  assert.equal(intent('file_move', { from: 'a.txt', to: 'b.txt' }), 'Requested by: move a.txt → b.txt');
  assert.equal(intent('file_move'), 'Requested by: move →');
  assert.equal(intent('file_delete'), 'Requested by: delete workspace path');
  assert.equal(intent('file_read', { path: 'README.md' }), 'Requested by: read README.md');
  assert.equal(intent('file_search'), 'Requested by: search workspace');
  assert.equal(intent('command_run', { executable: 'npm', args: ['test'] }), 'Requested by: run npm test');
  assert.equal(intent('command_run', { command: { executable: 'git', args: 'status' } }), 'Requested by: run git');
  assert.equal(intent('shell_run', { script: 'echo hi' }), 'Requested by: run shell: echo hi');
  assert.equal(intent('shell_run'), 'Requested by: run shell:');
  assert.equal(intent('git_commit'), 'Requested by: git commit:');
  assert.equal(intent('git_push', { remote: 'upstream', branch: 'main' }), 'Requested by: git push upstream/main');
  assert.equal(intent('git_push'), 'Requested by: git push origin/current');
  assert.equal(intent('process_start', { command: { executable: 'node' } }), 'Requested by: start process node');
  assert.equal(intent('process_start', { executable: 'vite', args: ['dev'] }), 'Requested by: start process vite dev');
  assert.equal(intent('custom_tool'), 'Requested by: custom_tool');
  const noArgs = presentApproval(ticket({ payload: { tool: 'capability_request', original: { tool: 'file_read' } } }));
  assert.equal(noArgs.preview, 'Requested by: read workspace file');
});

test('file, git, and rollback operations fall back to family and default labels', () => {
  const view = (family: string, payload: Record<string, unknown> = {}) => presentApproval(ticket({ operation: { family }, payload }));
  assert.deepEqual(view('files:delete', { path: 'dist' }), { title: 'Delete workspace content', action: 'Delete file', target: 'dist' });
  assert.equal(view('files:delete').target, 'workspace path');
  assert.equal(view('files:write', { path: 'a.ts' }).target, 'a.ts');
  assert.equal(view('files:write').target, 'workspace path');
  assert.equal(view('x', { tool: 'file_patch' }).target, 'workspace path');
  assert.equal(view('x', { tool: 'file_move' }).target, '→');
  assert.equal(view('git:push').target, 'origin/current branch');
  assert.deepEqual(view('git:commit'), { title: 'Git commit', action: 'Create commit', target: 'Active workspace', preview: '' });
  assert.equal(view('change:rollback').target, 'change set');
  assert.equal(view('x', { tool: 'change_rollback', args: { changeSetId: 'cs-1' } }).target, 'cs-1');
  assert.equal(view('x', { tool: 'process_start', args: { executable: 'node', args: ['a.js'] } }).preview, 'node a.js');
});

test('shell and command previews use execution target and script sources', () => {
  const shellFamily = presentApproval(ticket({ operation: { family: 'shell:bash' }, payload: {} }));
  assert.deepEqual(shellFamily, { title: 'Run shell script', action: 'Run bash', target: 'Strict sandbox' });
  const fromArgs = presentApproval(
    ticket({ operation: { family: 'shell:' }, payload: { sourceTool: 'shell_run', executionMode: 'host', command: { args: ['-c', 'ls -la'] } } }),
  );
  assert.equal(fromArgs.action, 'Run shell');
  assert.equal(fromArgs.target, 'Host workspace');
  assert.equal(fromArgs.preview, 'ls -la');
  const noScript = presentApproval(ticket({ operation: { family: 'x' }, payload: { tool: 'shell_run', shell: 'pwsh', command: { args: 'not-array' } } }));
  assert.equal(noScript.action, 'Run pwsh');
  assert.equal(noScript.preview, undefined);
  const command = presentApproval(ticket({ operation: { family: 'x' }, payload: { tool: 'command_run', args: { executionMode: 'host' } } }));
  assert.deepEqual(command, { title: 'Run command', action: 'Execute command', target: 'Host workspace', preview: '' });
});

test('unknown operations fall back through family, capability, and default labels', () => {
  assert.deepEqual(presentApproval(ticket({ operation: { family: '', capability: 'net.fetch' }, workspaceId: '' })), {
    title: 'Operation approval',
    action: 'net.fetch',
    target: 'Aevra',
  });
  assert.equal(presentApproval(ticket({ operation: undefined })).action, 'Operation');
});

test('workspace, skills, long scripts, and label truncation', () => {
  assert.deepEqual(presentApproval(ticket({ payload: { tool: 'workspace_select', workspaceId: 'ws-9' } })), {
    title: 'Workspace access',
    action: 'Read workspace',
    target: 'ws-9',
  });
  assert.equal(presentApproval(ticket({ operation: { family: 'workspace:select' } })).target, 'ws-1');
  assert.equal(presentApproval(ticket({ operation: { family: 'skills:read' } })).title, 'Local skills access');
  const long = 'echo sample '.repeat(400);
  const shell = presentApproval(ticket({ payload: { tool: 'shell_run', script: long } }));
  assert.equal(shell.truncated, true);
  assert.equal(shell.previewFullLength, long.length);
  assert.equal(shell.preview?.length, 4000);
  assert.ok(shell.preview?.endsWith('…'));
  const shortScript = presentApproval(ticket({ payload: { tool: 'shell_run', script: 'echo sample' } }));
  assert.equal(shortScript.truncated, undefined);
  const label = presentApproval(ticket({ operation: { family: 'word '.repeat(60) } }));
  assert.equal(label.action.length, 120);
  const token = presentApproval(ticket({ operation: { family: 'plain-words-sample-value-2024 done' } }));
  assert.equal(token.action, '[REDACTED] done');
  const noDigits = presentApproval(ticket({ operation: { family: 'plain-words-sample-value-only done' } }));
  assert.equal(noDigits.action, 'plain-words-sample-value-only done');
});
