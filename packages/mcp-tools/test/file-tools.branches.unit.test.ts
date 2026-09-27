import assert from 'node:assert/strict';
import test from 'node:test';
import { handleFileTool } from '../src/file-tools.js';

function fixture(o: any = {}) {
  const calls: any[] = [];
  const requests: any[] = [];
  const reads: any[] = [];
  const lease = { workspaceId: 'w1', capabilities: o.capabilities ?? [] };
  const op =
    (kind: string) =>
    async (...args: any[]) => (calls.push([kind, ...args]), { kind });
  const context: any = {
    sessions: {
      get: () => ({ id: 's1', actor: 'oauth:ChatGPT', subject: 'subject' }),
      activeLease: () => lease,
      leases: () => [lease],
      leaseForWorkspace: () => lease,
      isYolo: () => false,
    },
    workspaces: { capabilityRoots: () => [] },
    worker: {
      execute: async (input: any) => {
        calls.push(['worker', input]);
        return { ok: true, value: o.value ?? { kind: input.operation.kind } };
      },
    },
    reads: { put: (row: any) => reads.push(row) },
    approvals: {
      request: async (input: any) => {
        requests.push(input);
        return { status: 'approval_pending', requestId: `req${requests.length}` };
      },
    },
    deps: {
      operations: {
        write: op('write'),
        create: op('create'),
        move: op('move'),
        patch: op('patch'),
        delete: op('delete'),
      },
      ...(o.security ? { security: o.security } : {}),
      ...(o.globs ? { manifests: { globsFor: () => o.globs } } : {}),
    },
    oneTimeCapabilities: new Set<string>(),
  };
  return { context, calls, requests, reads };
}

test('read tools without a lease capability return the capability approval request', async () => {
  const f = fixture();
  const pending: any = await handleFileTool(f.context, 's1', 'file_read', {});
  assert.equal(pending.status, 'approval_pending');
  assert.equal(pending.requiredCapability, 'files.read');
  const search: any = await handleFileTool(f.context, 's1', 'file_search', {});
  assert.equal(search.requiredCapability, 'files.search');
  assert.equal(f.requests[1].operation.family, 'capability:files.search');
  assert.equal(f.calls.length, 0, 'nothing reaches the worker before approval');
});

test('every mutation returns the write/delete approval request when not granted', async () => {
  const f = fixture();
  for (const [name, args, cap] of [
    ['file_write', { path: '/a' }, 'files.write'],
    ['file_create', { path: '/a' }, 'files.write'],
    ['file_move', { from: '/a', to: '/b' }, 'files.write'],
    ['file_patch', { path: '/a' }, 'files.write'],
    ['file_delete', { path: '/a', recursive: true }, 'files.delete'],
  ] as const) {
    const result: any = await handleFileTool(f.context, 's1', name, args);
    assert.equal(result.status, 'approval_pending', name);
    assert.equal(result.requiredCapability, cap, name);
    assert.equal(f.requests.at(-1).payload.original.tool, name);
  }
  assert.equal(f.requests.at(-1).operation.risk, 'HIGH', 'recursive delete is high risk');
  assert.equal(f.calls.length, 0);
});

test('sensitive move sources and delete targets need an immutable security approval', async () => {
  const security = {
    authorizeResource: ({ logicalPath, mutation }: any) => ({
      workspaceId: 'w1',
      sensitivity: logicalPath === '/keys.conf' ? 'SENSITIVE' : 'NORMAL',
      decision: logicalPath === '/keys.conf' && mutation ? 'approval-required' : 'allow',
    }),
  };
  const f = fixture({ security, capabilities: ['files.write', 'files.delete'] });
  const moved: any = await handleFileTool(f.context, 's1', 'file_move', {
    from: '/plain.txt',
    to: '/keys.conf',
  });
  assert.equal(moved.securityApprovalScope, 'once');
  assert.equal(f.requests[0].operation.family, 'security:sensitive:file_move');
  const deleted: any = await handleFileTool(f.context, 's1', 'file_delete', { path: '/keys.conf' });
  assert.equal(deleted.securityApprovalScope, 'once');
  assert.equal(f.requests[1].operation.family, 'security:sensitive:file_delete');
  assert.equal(f.calls.length, 0);
});

test('write and patch default missing content to empty strings', async () => {
  const f = fixture({ capabilities: ['files.write'] });
  await handleFileTool(f.context, 's1', 'file_write', { path: '/a' });
  await handleFileTool(f.context, 's1', 'file_patch', { path: '/a' });
  assert.equal(f.calls[0][2].content, '');
  assert.equal(f.calls[1][2].patch, '');
});

test('declared protected globs travel with read and search operations', async () => {
  const globs = [{ pattern: 'private/**', sensitivity: 'SECRET' }];
  const f = fixture({ capabilities: ['files.read', 'files.search'], globs });
  await handleFileTool(f.context, 's1', 'file_search', {});
  const search = f.calls[0][1].operation;
  assert.deepEqual(search, { kind: 'file.search', path: '/', query: '', protectedGlobs: globs });
  await handleFileTool(f.context, 's1', 'file_list', {});
  assert.deepEqual(f.calls[1][1].operation, { kind: 'file.list', path: '/' });

  const bare = fixture({ capabilities: ['files.read'], globs: [] });
  await handleFileTool(bare.context, 's1', 'file_list', { path: '/src' });
  assert.equal('protectedGlobs' in bare.calls[0][1].operation, false);
});

test('file_read clamps a non-numeric length and fills range metadata from content', async () => {
  const f = fixture({ capabilities: ['files.read'], value: { path: '/a.txt', content: 'hello' } });
  const read: any = await handleFileTool(f.context, 's1', 'file_read', {
    path: '/a.txt',
    length: 'lots',
  });
  assert.equal(f.calls[0][1].operation.length, 0);
  assert.equal('offset' in f.calls[0][1].operation, false);
  assert.deepEqual([read.offset, read.length, read.totalLength], [0, 5, 5]);

  const empty = fixture({ capabilities: ['files.read'], value: { path: '/a.txt' } });
  const blank: any = await handleFileTool(empty.context, 's1', 'file_read', {
    path: '/a.txt',
    offset: 3,
  });
  assert.deepEqual([blank.offset, blank.length, blank.totalLength], [3, 0, 0]);
});

test('file_read without a path argument falls back to the returned path', async () => {
  const f = fixture({
    capabilities: ['files.read'],
    value: { path: '/from-worker.txt', content: 'x', hash: 'h' },
  });
  const read: any = await handleFileTool(f.context, 's1', 'file_read', {});
  assert.equal(read.path, '/from-worker.txt');
  assert.equal(f.reads[0].path, '/from-worker.txt');
  assert.equal(f.reads[0].content, 'x');

  const nameless = fixture({ capabilities: ['files.read'], value: { content: 'y' } });
  const r: any = await handleFileTool(nameless.context, 's1', 'file_read', {});
  assert.equal(r.sensitivity, 'NORMAL');
  assert.equal(r.path, 'undefined');
});

test('returned SECRET and SENSITIVE classifications apply even without a path argument', async () => {
  const secret = fixture({
    capabilities: ['files.read'],
    value: { path: '/worker-said.txt', content: 'x', sensitivity: 'SECRET' },
  });
  await assert.rejects(
    () => handleFileTool(secret.context, 's1', 'file_read', {}),
    (e: any) => e.code === 'CAPABILITY_REQUIRED' && /worker-said\.txt/.test(e.message),
  );
  const nameless = fixture({ capabilities: ['files.read'], value: { sensitivity: 'SECRET' } });
  await assert.rejects(
    () => handleFileTool(nameless.context, 's1', 'file_read', {}),
    (e: any) => e.code === 'CAPABILITY_REQUIRED' && /remotely: $/.test(e.message),
  );

  const sensitive = fixture({
    capabilities: ['files.read'],
    value: { path: '/worker-said.txt', sensitivity: 'SENSITIVE' },
  });
  const masked: any = await handleFileTool(sensitive.context, 's1', 'file_read', {});
  assert.equal(masked.sensitivity, 'SENSITIVE');
  assert.equal(sensitive.reads.length, 0, 'sensitive reads are never cached as merge bases');
  const sensitiveNoPath = fixture({
    capabilities: ['files.read'],
    value: { content: 'a', sensitivity: 'SENSITIVE' },
  });
  const m2: any = await handleFileTool(sensitiveNoPath.context, 's1', 'file_read', {});
  assert.equal(m2.sensitivity, 'SENSITIVE');
});
