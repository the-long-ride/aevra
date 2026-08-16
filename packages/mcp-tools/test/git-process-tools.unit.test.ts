import assert from 'node:assert/strict';
import test from 'node:test';
import { gitTool } from '../src/git-tools.js';
import { handleProcessChangeTool, processStart } from '../src/process-change-tools.js';

function context(options: { yolo?: boolean; workerFailure?: boolean } = {}) {
  const workerCalls: any[] = [];
  const processCalls: any[] = [];
  const changeCalls: any[] = [];
  const lease = { workspaceId: 'w1', capabilities: [] };
  const sessions: any = {
    get: () => ({ id: 's1', actor: 'oauth:ChatGPT', subject: 'subject' }),
    activeLease: () => lease,
    isYolo: () => options.yolo ?? true,
  };
  const processes: any = {
    start: async (...args: any[]) => {
      processCalls.push(['start', ...args]);
      return { id: 'p1', state: 'running' };
    },
    list: (sessionId: string) => {
      processCalls.push(['list', sessionId]);
      return [{ id: 'p1' }];
    },
    status: async (...args: any[]) => {
      processCalls.push(['status', ...args]);
      return { ok: true, value: { id: args[1], state: 'running' } };
    },
    wait: async (...args: any[]) => {
      processCalls.push(['wait', ...args]);
      return { ok: true, value: { id: args[1], state: 'completed' } };
    },
    command: async (...args: any[]) => {
      processCalls.push(['command', ...args]);
      return { ok: true, value: { id: args[2], kind: args[1], cursor: args[3] } };
    },
  };
  const changes: any = {
    begin: (...args: any[]) => {
      changeCalls.push(['begin', ...args]);
      return { id: 'c1' };
    },
    status: (...args: any[]) => {
      changeCalls.push(['status', ...args]);
      return { id: args[0], state: 'OPEN' };
    },
    commit: (...args: any[]) => {
      changeCalls.push(['commit', ...args]);
      return { id: args[0], state: 'COMMITTED' };
    },
    rollback: async (...args: any[]) => {
      changeCalls.push(['rollback', ...args]);
      return { id: args[0], state: 'ROLLED_BACK' };
    },
  };
  const worker: any = {
    execute: async (input: any) => {
      workerCalls.push(input);
      if (options.workerFailure)
        return { ok: false, error: { code: 'INVALID_REQUEST', message: 'worker failed' } };
      if (input.operation.kind === 'git.log' && input.operation.args?.includes('--format=%H')) {
        return { ok: true, value: { stdout: 'abc123\n' } };
      }
      return { ok: true, value: { kind: input.operation.kind } };
    },
  };
  return {
    value: {
      sessions,
      workspaces: { capabilityRoots: () => [] },
      worker,
      reads: {} as any,
      deps: { processes, changes },
      oneTimeCapabilities: new Set<string>(),
      processStart: async () => ({}),
      callInner: async () => ({}),
    } as any,
    workerCalls,
    processCalls,
    changeCalls,
  };
}

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
  assert.equal(call[2].executable, 'node');
  assert.equal(call[2].cwdLogical, '/');
  assert.equal(call[3], 'keep-running');
  assert.equal(call[4], 'Server');

  await processStart(fx.value, 's1', { executable: 'npm', args: ['test'], lifecycle: 'invalid' });
  assert.equal(fx.processCalls.at(-1)?.[3], 'stop-with-aevra');
});

test('process and change dispatcher covers every supported operation', async () => {
  const fx = context();
  const calls = [
    ['process_list', {}, (value: any) => assert.equal(value[0].id, 'p1')],
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
