import assert from 'node:assert/strict';
import test from 'node:test';
import { gitTool } from '../src/git-tools.js';
import { handleProcessChangeTool, processStart } from '../src/process-change-tools.js';
import { processGitTestContext as context } from './git-process-tools.fixture.js';

test('git tool dispatches every git operation and snapshots repository state for mutations', async () => {
  const fx = context();
  const cases = [
    ['git_status', {}, 'git.status'],
    ['git_diff', { args: ['--stat'] }, 'git.diff'],
    ['git_log', { args: ['-2'] }, 'git.log'],
    ['git_branch', { args: ['--show-current'] }, 'git.branch'],
    ['git_commit', { message: 'test', args: ['--no-verify'] }, 'git.commit'],
    ['git_push', { remote: 'origin', branch: 'main', args: ['--porcelain'] }, 'git.push'],
  ] as const;
  for (const [name, args, kind] of cases) {
    const before = fx.workerCalls.length;
    const result: any = await gitTool(fx.value, 's1', name, args);
    assert.equal(result.kind, kind);
    const recent = fx.workerCalls.slice(before);
    assert.equal(recent.at(-1)?.operation.kind, kind);
    assert.equal(recent.at(-1)?.executionMode, 'host');
    if (name === 'git_commit' || name === 'git_push') {
      assert.equal(recent[0]?.operation.kind, 'git.log');
    }
  }

  // Git tools with default/omitted args property
  await gitTool(fx.value, 's1', 'git_diff', {});
  await gitTool(fx.value, 's1', 'git_log', {});
  await gitTool(fx.value, 's1', 'git_branch', {});
  await gitTool(fx.value, 's1', 'git_commit', { message: 'm' });
  await gitTool(fx.value, 's1', 'git_push', { remote: 'origin', branch: 'main' });
});

test('git tool wraps worker errors and repo state tolerates failed head lookup', async () => {
  const failed = context({ workerFailure: true });
  await assert.rejects(
    () => gitTool(failed.value, 's1', 'git_status', {}),
    (error: any) => error.code === 'INVALID_REQUEST' && /worker failed/.test(error.message),
  );
  await assert.rejects(
    () => gitTool(failed.value, 's1', 'git_commit', { message: 'x' }),
    (error: any) => error.code === 'INVALID_REQUEST',
  );

  const { repoState } = await import('../src/git-state.js');
  const emptyWorkerContext = context();
  emptyWorkerContext.value.worker = {
    execute: async () => ({ ok: true, value: { stdout: '   ' } }),
  };
  const emptyState = await repoState(
    emptyWorkerContext.value,
    's1',
    'w1',
    emptyWorkerContext.value.workspaces.capabilityRoots('w1'),
  );
  assert.deepEqual(emptyState, {});

  const noStdoutContext = context();
  noStdoutContext.value.worker = {
    execute: async () => ({ ok: true, value: {} }),
  };
  assert.deepEqual(
    await repoState(
      noStdoutContext.value,
      's1',
      'w1',
      noStdoutContext.value.workspaces.capabilityRoots('w1'),
    ),
    {},
  );

  const { asToolError } = await import('../src/errors.js');
  const stringErr = asToolError('raw string failure');
  assert.equal(stringErr.message, 'raw string failure');
  assert.equal(stringErr.code, 'INVALID_REQUEST');

  const objErr = asToolError({ code: 'NOT_FOUND', message: 'not found' });
  assert.equal(objErr.code, 'NOT_FOUND');
});

test('process start normalizes command lifecycle and process metadata', async () => {
  const fx = context();
  const result = await processStart(fx.value, 's1', {
    command: { executable: 'node', args: ['app.js'], env: { MODE: 'test' } },
    lifecycle: 'keep-running',
    name: 'Server',
  });
  assert.equal(result.id, 'p1');
  const call = fx.processCalls[0];
  assert.equal(call[0], 'start');
  assert.equal(call[2], 'w1');
  assert.equal(call[3].executable, 'node');
  assert.equal(call[3].cwdLogical, '/');
  assert.equal(call[4], 'keep-running');
  assert.equal(call[5], 'Server');

  await processStart(fx.value, 's1', { executable: 'npm', args: ['test'], lifecycle: 'invalid' });
  assert.equal(fx.processCalls.at(-1)?.[4], 'stop-with-aevra');
});

test('process start preserves cwdLogical and YOLO overrides standing deny for non-critical work', async () => {
  const yolo = context({ yolo: true, permissionOutcome: 'deny' });
  await processStart(yolo.value, 's1', {
    executable: 'node',
    args: ['app.js'],
    cwdLogical: '/packages/api',
  });
  assert.equal(yolo.processCalls[0]?.[3]?.cwdLogical, '/packages/api');

  const allowed = context();
  await processStart(allowed.value, 's1', {
    executable: 'node',
    args: ['app.js'],
    cwdLogical: '/packages/api',
  });
  assert.equal(allowed.processCalls[0]?.[3]?.cwdLogical, '/packages/api');
});

test('process start keeps classifier CRITICAL risk as mandatory approval under unrestricted YOLO', async () => {
  const fx = context({ yolo: true });
  await assert.rejects(
    () => processStart(fx.value, 's1', { executable: 'shutdown', args: [] }),
    (error: any) => error.code === 'APPROVAL_PENDING',
  );
  assert.equal(fx.processCalls.length, 0);
});

test('process dispatcher uses workspace-first ProcessService signatures', async () => {
  const fx = context();
  fx.value.workspaceId = 'w1';

  await handleProcessChangeTool(fx.value, 's1', 'process_status', { processId: 'p1' });
  await handleProcessChangeTool(fx.value, 's1', 'process_wait', { processId: 'p1', timeoutMs: 25 });
  await handleProcessChangeTool(fx.value, 's1', 'process_logs', {
    processId: 'p1',
    cursor: 'cur1',
  });
  await handleProcessChangeTool(fx.value, 's1', 'process_stop', { processId: 'p1' });
  await handleProcessChangeTool(fx.value, 's1', 'process_restart', { processId: 'p1' });

  assert.deepEqual(fx.processCalls.find((call) => call[0] === 'status')?.slice(1), [
    's1',
    'w1',
    'p1',
  ]);
  assert.deepEqual(fx.processCalls.find((call) => call[0] === 'wait')?.slice(1), [
    's1',
    'w1',
    'p1',
    25,
  ]);
  const commandArgs = (kind: string) =>
    fx.processCalls.find((call) => call[0] === 'command' && call[3] === kind)?.slice(1);
  assert.deepEqual(commandArgs('process.logs'), ['s1', 'w1', 'process.logs', 'p1', 'cur1']);
  assert.deepEqual(commandArgs('process.stop'), ['s1', 'w1', 'process.stop', 'p1', undefined]);
  assert.deepEqual(commandArgs('process.restart'), [
    's1',
    'w1',
    'process.restart',
    'p1',
    undefined,
  ]);
});

test('process and change dispatcher covers every supported operation', async () => {
  const fx = context();
  const calls = [
    ['process_list', {}, (value: any) => assert.equal(value.result[0].id, 'p1')],
    ['process_status', { processId: 7 }, (value: any) => assert.equal(value.id, '7')],
    [
      'process_wait',
      { processId: 'p1', timeoutMs: '25' },
      (value: any) => assert.equal(value.state, 'completed'),
    ],
    ['process_wait', { processId: 'p1' }, (value: any) => assert.equal(value.state, 'completed')],
    [
      'process_logs',
      { processId: 'p1', cursor: '4' },
      (value: any) => assert.equal(value.kind, 'process.logs'),
    ],
    ['process_stop', { processId: 'p1' }, (value: any) => assert.equal(value.kind, 'process.stop')],
    [
      'process_restart',
      { processId: 'p1' },
      (value: any) => assert.equal(value.kind, 'process.restart'),
    ],
    ['change_begin', { name: 'test' }, (value: any) => assert.equal(value.id, 'c1')],
    ['change_status', { changeSetId: 'c1' }, (value: any) => assert.equal(value.state, 'OPEN')],
    [
      'change_commit',
      { changeSetId: 'c1' },
      (value: any) => assert.equal(value.state, 'COMMITTED'),
    ],
    [
      'change_rollback',
      { changeSetId: 'c1' },
      (value: any) => assert.equal(value.state, 'ROLLED_BACK'),
    ],
  ] as const;
  for (const [name, args, check] of calls) {
    check(await handleProcessChangeTool(fx.value, 's1', name, args));
  }
  assert.deepEqual(fx.changeCalls.find((call) => call[0] === 'rollback')?.[2], {
    force: false,
    skipPaths: [],
  });
  await assert.rejects(
    () => handleProcessChangeTool(fx.value, 's1', 'missing_tool', {}),
    (error: any) => error.code === 'CAPABILITY_REQUIRED',
  );
});

test('process dispatcher reports unavailable and failed process results', async () => {
  const fx = context();
  fx.value.deps.processes.status = async () => undefined;
  await assert.rejects(
    () => handleProcessChangeTool(fx.value, 's1', 'process_status', { processId: 'missing' }),
    (error: any) => error.code === 'CAPABILITY_REQUIRED',
  );

  fx.value.deps.processes.status = async () => ({
    ok: false,
    error: { code: 'NOT_FOUND', message: 'missing process', details: { id: 'p2' } },
  });
  await assert.rejects(
    () => handleProcessChangeTool(fx.value, 's1', 'process_status', { processId: 'p2' }),
    (error: any) => error.code === 'NOT_FOUND' && error.details?.id === 'p2',
  );

  fx.value.deps.processes = undefined;
  await assert.rejects(
    () => handleProcessChangeTool(fx.value, 's1', 'process_list', {}),
    (error: any) => error.code === 'CAPABILITY_REQUIRED',
  );
  await assert.rejects(
    () => handleProcessChangeTool(fx.value, 's1', 'process_wait', { processId: 'p1' }),
    (error: any) => error.code === 'CAPABILITY_REQUIRED',
  );
  await assert.rejects(
    () => handleProcessChangeTool(fx.value, 's1', 'process_logs', { processId: 'p1' }),
    (error: any) => error.code === 'CAPABILITY_REQUIRED',
  );

  fx.value.deps.changes = undefined;
  await assert.rejects(
    () => handleProcessChangeTool(fx.value, 's1', 'change_begin', { name: 'n' }),
    (error: any) => error.code === 'CAPABILITY_REQUIRED',
  );
  await assert.rejects(
    () => handleProcessChangeTool(fx.value, 's1', 'change_status', {}),
    (error: any) => error.code === 'CAPABILITY_REQUIRED',
  );
  await assert.rejects(
    () => handleProcessChangeTool(fx.value, 's1', 'change_commit', { changeSetId: 'c1' }),
    (error: any) => error.code === 'CAPABILITY_REQUIRED',
  );
});
