import assert from 'node:assert/strict';
import test from 'node:test';
import { HookService } from '../src/hook-service.js';

function settings(hooks: unknown[]) {
  return {
    get<T>(_key: string, _defaultValue: T): T {
      return hooks as T;
    },
  };
}

test('hook service honors block control on pre events', async () => {
  const service = new HookService(
    settings([
      {
        id: 'hook-1',
        name: 'guard',
        event: 'before_tool_call',
        enabled: true,
        kind: 'command',
        execution: 'run',
        executable: 'node',
        args: [],
        permissions: ['observe', 'block'],
        timeoutMs: 1000,
        failurePolicy: 'continue',
      },
    ]),
    {
      async execute() {
        return {
          ok: true,
          value: { exitCode: 0, stdout: 'log\n{"action":"block","message":"denied"}\n' },
        } as any;
      },
    },
  );
  const result = await service.emit('before_tool_call', { sessionId: 's' }, { name: 'x' });
  assert.equal(result.blocked, true);
  assert.equal(result.reason, 'denied');
});

test('hook service applies permitted tool-input transformations', async () => {
  const service = new HookService(
    settings([
      {
        id: 'hook-transform',
        name: 'rewrite',
        event: 'before_tool_call',
        enabled: true,
        kind: 'command',
        execution: 'run',
        executable: 'node',
        args: [],
        permissions: ['observe', 'modifyToolInput'],
        timeoutMs: 1000,
        failurePolicy: 'continue',
      },
    ]),
    {
      async execute() {
        return {
          ok: true,
          value: {
            exitCode: 0,
            stdout: '{"action":"modify","payload":{"name":"rewritten","args":{"safe":true}}}',
          },
        } as any;
      },
    },
  );
  const result = await service.emit(
    'before_tool_call',
    { sessionId: 's' },
    { name: 'original', args: {} },
  );
  assert.equal(result.blocked, false);
  assert.deepEqual(result.payload, { name: 'rewritten', args: { safe: true } });
});

test('hook service ignores transformations without the matching permission', async () => {
  const service = new HookService(
    settings([
      {
        id: 'hook-observer',
        name: 'observer',
        event: 'before_tool_call',
        enabled: true,
        kind: 'command',
        execution: 'run',
        executable: 'node',
        args: [],
        permissions: ['observe'],
        timeoutMs: 1000,
        failurePolicy: 'continue',
      },
    ]),
    {
      async execute() {
        return {
          ok: true,
          value: {
            exitCode: 0,
            stdout: '{"action":"modify","payload":{"name":"rewritten","args":{}}}',
          },
        } as any;
      },
    },
  );
  const original = { name: 'original', args: { value: 1 } };
  const result = await service.emit('before_tool_call', { sessionId: 's' }, original);
  assert.deepEqual(result.payload, original);
});

test('after events are observable and cannot retroactively block', async () => {
  const service = new HookService(
    settings([
      {
        id: 'hook-2',
        name: 'observer',
        event: 'after_tool_call',
        enabled: true,
        kind: 'custom-kind',
        execution: 'run',
        executable: 'node',
        args: [],
        permissions: ['observe', 'block'],
        timeoutMs: 1000,
        failurePolicy: 'block',
      },
    ]),
    {
      async execute() {
        return { ok: true, value: { exitCode: 7, stdout: '{"action":"block"}' } } as any;
      },
    },
  );
  const result = await service.emit('after_tool_call', { sessionId: 's' }, { ok: true });
  assert.equal(result.blocked, false);
  assert.equal(result.invocations.length, 1);
  assert.equal(result.invocations[0]?.ok, false);
});

test('after-tool hooks may transform tool output with permission', async () => {
  const service = new HookService(
    settings([
      {
        id: 'hook-output',
        name: 'output rewrite',
        event: 'after_tool_call',
        enabled: true,
        kind: 'command',
        execution: 'run',
        executable: 'node',
        args: [],
        permissions: ['observe', 'modifyToolOutput'],
        timeoutMs: 1000,
        failurePolicy: 'continue',
      },
    ]),
    {
      async execute() {
        return {
          ok: true,
          value: {
            exitCode: 0,
            stdout: '{"action":"modify","payload":{"name":"x","result":{"masked":true}}}',
          },
        } as any;
      },
    },
  );
  const result = await service.emit(
    'after_tool_call',
    { sessionId: 's' },
    { name: 'x', result: { raw: true } },
  );
  assert.deepEqual(result.payload, { name: 'x', result: { masked: true } });
  assert.equal(result.blocked, false);
});

test('after_response alias runs on response_finished', async () => {
  let calls = 0;
  const service = new HookService(
    settings([
      {
        id: 'hook-3',
        name: 'response observer',
        event: 'after_response',
        enabled: true,
        kind: 'app',
        execution: 'launch',
        executable: 'viewer',
        args: [],
        permissions: ['observe'],
        timeoutMs: 1000,
        failurePolicy: 'continue',
      },
    ]),
    {
      async execute() {
        calls += 1;
        return { ok: true, value: { launched: true, pid: 10 } } as any;
      },
    },
  );
  const result = await service.emit('response_finished', {}, {});
  assert.equal(result.blocked, false);
  assert.equal(calls, 1);
});

test('hook service handles failurePolicy block and execution exceptions', async () => {
  const service = new HookService(
    settings([
      {
        id: 'hook-block-on-fail',
        name: 'failing guard',
        event: 'before_tool_call',
        enabled: true,
        kind: 'command',
        execution: 'run',
        executable: 'node',
        args: [],
        permissions: ['observe', 'block'],
        timeoutMs: 1000,
        failurePolicy: 'block',
      },
    ]),
    {
      async execute() {
        return { ok: true, value: { exitCode: 1, stdout: '' } } as any;
      },
    },
  );

  const blocked = await service.emit('before_tool_call', { sessionId: 's' }, {});
  assert.equal(blocked.blocked, true);
  assert.ok(blocked.reason?.includes('failed during before_tool_call'));

  const workerFailService = new HookService(
    settings([
      {
        id: 'hook-worker-fail',
        name: 'failing worker guard',
        event: 'before_tool_call',
        enabled: true,
        kind: 'command',
        execution: 'run',
        executable: 'node',
        args: [],
        permissions: ['observe', 'block'],
        timeoutMs: 1000,
        failurePolicy: 'block',
      },
    ]),
    {
      async execute() {
        return { ok: false, error: { message: 'worker crashed' } } as any;
      },
    },
  );
  const workerBlocked = await workerFailService.emit('before_tool_call', { sessionId: 's' }, {});
  assert.equal(workerBlocked.blocked, true);
  assert.equal(workerBlocked.reason, 'worker crashed');

  const throwService = new HookService(
    settings([
      {
        id: 'hook-throw',
        name: 'throwing guard',
        event: 'before_tool_call',
        enabled: true,
        kind: 'command',
        execution: 'run',
        executable: 'node',
        args: [],
        permissions: ['observe', 'block'],
        timeoutMs: 1000,
        failurePolicy: 'block',
      },
    ]),
    {
      async execute() {
        throw new Error('network fault');
      },
    },
  );

  const thrownBlock = await throwService.emit('before_tool_call', { sessionId: 's' }, {});
  assert.equal(thrownBlock.blocked, true);
  assert.equal(thrownBlock.reason, 'network fault');

  // Test grandfathered permissions without explicit permissions field and invalid JSON in stdout
  const legacyHookService = new HookService(
    settings([
      {
        id: 'hook-legacy',
        event: 'before_tool_call',
        enabled: true,
        kind: 'command',
        executable: 'node',
      },
      {
        id: 'hook-ignore-fail',
        event: 'before_tool_call',
        enabled: true,
        failurePolicy: 'continue',
      },
    ]),
    {
      async execute(input: any) {
        if (input.operation.event === 'before_tool_call' && input.operation.executable === 'node') {
          return { ok: true, value: { exitCode: 0, stdout: 'invalid JSON output!' } } as any;
        }
        return { ok: false, error: { message: 'ignored error' } } as any;
      },
    },
  );
  const legacyRes = await legacyHookService.emit('before_tool_call', {}, {});
  assert.equal(legacyRes.blocked, false);
});
