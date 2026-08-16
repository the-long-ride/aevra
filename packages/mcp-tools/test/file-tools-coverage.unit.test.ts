import assert from 'node:assert/strict';
import test from 'node:test';
import { handleFileTool } from '../src/file-tools.js';
import { oneTimeKey } from '../src/service-helpers.js';

function fixture(options: { security?: any; worker?: any; operations?: any; yolo?: boolean } = {}) {
  const calls: any[] = [];
  const lease = {
    workspaceId: 'w1',
    capabilities: ['files.read', 'files.search', 'files.write', 'files.delete'],
  };
  const operations = options.operations ?? {
    write: async (...args: any[]) => {
      calls.push(['write', ...args]);
      return { kind: 'write' };
    },
    create: async (...args: any[]) => {
      calls.push(['create', ...args]);
      return { kind: 'create' };
    },
    move: async (...args: any[]) => {
      calls.push(['move', ...args]);
      return { kind: 'move' };
    },
    patch: async (...args: any[]) => {
      calls.push(['patch', ...args]);
      return { kind: 'patch' };
    },
    delete: async (...args: any[]) => {
      calls.push(['delete', ...args]);
      return { kind: 'delete' };
    },
  };
  const worker = options.worker ?? {
    execute: async (input: any) => {
      calls.push(['worker', input]);
      if (input.operation.kind === 'file.read') {
        return {
          ok: true,
          value: {
            path: input.operation.path,
            content: 'visible',
            hash: 'hash',
            sensitivity: 'NORMAL',
          },
        };
      }
      return { ok: true, value: { kind: input.operation.kind } };
    },
  };
  const reads: any[] = [];
  const context: any = {
    sessions: {
      get: () => ({ id: 's1', actor: 'oauth:ChatGPT', subject: 'subject' }),
      activeLease: () => lease,
      leases: () => [lease],
      leaseForWorkspace: () => lease,
      isYolo: () => options.yolo ?? true,
    },
    workspaces: { capabilityRoots: () => [] },
    worker,
    reads: { put: (row: any) => reads.push(row) },
    deps: { operations, ...(options.security ? { security: options.security } : {}) },
    oneTimeCapabilities: new Set<string>(),
    processStart: async () => ({}),
    callInner: async () => ({}),
  };
  return { context, calls, reads };
}

test('read-only file tools cover list search read defaults ranges cache and worker errors', async () => {
  const fx = fixture();
  const listed: any = await handleFileTool(fx.context, 's1', 'file_list', {});
  assert.equal(listed.kind, 'file.list');
  const searched: any = await handleFileTool(fx.context, 's1', 'file_search', { query: 9 });
  assert.equal(searched.kind, 'file.search');
  const read: any = await handleFileTool(fx.context, 's1', 'file_read', { path: '/a.txt' });
  assert.equal(read.content, 'visible');
  assert.equal(read.sensitivity, 'NORMAL');
  assert.equal(fx.reads.length, 1);

  const rangedFx = fixture({
    worker: {
      execute: async () => ({
        ok: true,
        value: { path: '/a', content: 'abc', hash: 'h', sensitivity: 'weird' },
      }),
    },
  });
  const ranged: any = await handleFileTool(rangedFx.context, 's1', 'file_read', {
    path: '/a',
    offset: 'bad',
    length: -3,
  });
  assert.equal(ranged.offset, 0);
  assert.equal(ranged.length, 3);
  assert.equal(ranged.totalLength, 3);
  assert.equal(ranged.sensitivity, 'NORMAL');
  assert.equal(rangedFx.reads.length, 0);

  const suppliedRange = fixture({
    worker: {
      execute: async () => ({
        ok: true,
        value: { path: '/a', content: 'abc', offset: 2, length: 1, totalLength: 8 },
      }),
    },
  });
  const supplied: any = await handleFileTool(suppliedRange.context, 's1', 'file_read', {
    path: '/a',
    offset: 2,
  });
  assert.deepEqual([supplied.offset, supplied.length, supplied.totalLength], [2, 1, 8]);

  const failed = fixture({
    worker: {
      execute: async () => ({
        ok: false,
        error: { code: 'NOT_FOUND', message: 'missing', details: { x: 1 } },
      }),
    },
  });
  await assert.rejects(
    () => handleFileTool(failed.context, 's1', 'file_read', { path: '/missing' }),
    (e: any) => e.code === 'NOT_FOUND' && e.details?.x === 1,
  );
});

test('read security covers custom deny sensitive masking returned escalation and SECRET escalation', async () => {
  const denied = fixture({
    security: {
      authorizeResource: () => ({ decision: 'deny', sensitivity: 'SECRET', workspaceId: 'w1' }),
    },
  });
  await assert.rejects(
    () => handleFileTool(denied.context, 's1', 'file_read', { path: '/secret' }),
    (e: any) => e.code === 'CAPABILITY_REQUIRED',
  );

  const sensitive = fixture({
    security: {
      authorizeResource: () => ({ decision: 'allow', sensitivity: 'SENSITIVE', workspaceId: 'w1' }),
    },
    worker: {
      execute: async () => ({
        ok: true,
        value: { path: '/credentials.json', content: 'TOKEN=value', hash: 'h' },
      }),
    },
  });
  const masked: any = await handleFileTool(sensitive.context, 's1', 'file_read', {
    path: '/credentials.json',
  });
  assert.equal(masked.sensitivity, 'SENSITIVE');
  assert.notEqual(masked.content, 'TOKEN=value');
  assert.equal(sensitive.reads.length, 0);

  const returnedSensitive = fixture({
    worker: {
      execute: async () => ({
        ok: true,
        value: { path: '/normal', content: 'TOKEN=value', sensitivity: 'SENSITIVE' },
      }),
    },
  });
  assert.equal(
    (
      (await handleFileTool(returnedSensitive.context, 's1', 'file_read', {
        path: '/normal',
      })) as any
    ).sensitivity,
    'SENSITIVE',
  );

  const returnedSecret = fixture({
    worker: {
      execute: async () => ({
        ok: true,
        value: { path: '/normal', content: 'x', sensitivity: 'SECRET' },
      }),
    },
  });
  await assert.rejects(
    () => handleFileTool(returnedSecret.context, 's1', 'file_read', { path: '/normal' }),
    (e: any) => e.code === 'CAPABILITY_REQUIRED',
  );
});

test('write create move patch and delete normalize inputs encoding risk and authorization', async () => {
  const fx = fixture();
  assert.equal(
    (
      (await handleFileTool(fx.context, 's1', 'file_write', {
        path: '/a',
        content: 7,
        expectedHash: 'h',
      })) as any
    ).kind,
    'write',
  );
  assert.equal(fx.calls.find((row) => row[0] === 'write')[2].content, '7');
  assert.equal(
    (
      (await handleFileTool(fx.context, 's1', 'file_create', {
        path: '/b',
        content: null,
        encoding: 'base64',
      })) as any
    ).kind,
    'create',
  );
  assert.equal(fx.calls.find((row) => row[0] === 'create')[2].encoding, 'base64');
  await handleFileTool(fx.context, 's1', 'file_create', { path: '/c', encoding: 'other' });
  assert.equal(fx.calls.filter((row) => row[0] === 'create').at(-1)[2].encoding, 'utf8');
  assert.equal(
    ((await handleFileTool(fx.context, 's1', 'file_move', { from: 1, to: 2 })) as any).kind,
    'move',
  );
  assert.equal(
    ((await handleFileTool(fx.context, 's1', 'file_patch', { path: '/a', patch: 4 })) as any).kind,
    'patch',
  );
  assert.equal(
    (
      (await handleFileTool(fx.context, 's1', 'file_delete', {
        path: '/a',
        recursive: false,
      })) as any
    ).kind,
    'delete',
  );
  assert.equal(
    (
      (await handleFileTool(fx.context, 's1', 'file_delete', {
        path: '/a',
        recursive: true,
      })) as any
    ).kind,
    'delete',
  );
});

test('fallback sensitivity blocks secret paths and requires one-time approval for sensitive mutations', async () => {
  const secret = fixture();
  await assert.rejects(
    () => handleFileTool(secret.context, 's1', 'file_write', { path: '/.env', content: 'x' }),
    (e: any) => e.code === 'CAPABILITY_REQUIRED',
  );

  const sensitive = fixture({ yolo: true });
  sensitive.context.oneTimeCapabilities.add(oneTimeKey('s1', 'files.write', '*'));
  const result: any = await handleFileTool(sensitive.context, 's1', 'file_write', {
    path: '/.npmrc',
    content: 'registry=x',
  });
  assert.equal(result.kind, 'write');
});

test('immutable sensitive mutation can return a pending approval response before operation execution', async () => {
  const fx = fixture({
    yolo: false,
    security: {
      authorizeResource: ({ mutation }: any) => ({
        decision: mutation ? 'approval-required' : 'allow',
        sensitivity: 'SENSITIVE',
        workspaceId: 'w1',
      }),
    },
  });
  fx.context.approvals = {
    request: async () => ({ status: 'approval_pending', requestId: 'req1' }),
  };
  const result: any = await handleFileTool(fx.context, 's1', 'file_patch', {
    path: '/a',
    patch: 'x',
  });
  assert.equal(result.status, 'approval_pending');
  assert.equal(result.securityApprovalScope, 'once');
  assert.equal(fx.calls.length, 0);
});

test('missing operation service throws configured-tool errors for all mutation families', async () => {
  for (const [name, args] of [
    ['file_write', { path: '/a' }],
    ['file_create', { path: '/a' }],
    ['file_move', { from: '/a', to: '/b' }],
    ['file_patch', { path: '/a', patch: '' }],
    ['file_delete', { path: '/a' }],
  ] as const) {
    const fx = fixture({ operations: undefined });
    fx.context.deps.operations = undefined;
    await assert.rejects(
      () => handleFileTool(fx.context, 's1', name, args),
      (e: any) => e.code === 'CAPABILITY_REQUIRED',
    );
  }
});
