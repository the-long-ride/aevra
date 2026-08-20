import assert from 'node:assert/strict';
import test from 'node:test';
import { SecurityGuard } from '../../../apps/core/src/security/security-guard.js';
import { handleFileTool } from '../src/file-tools.js';

function fixture(
  options: { yolo?: boolean; downgradeSensitivePath?: boolean; workerSensitivity?: string } = {},
) {
  const calls: any[] = [];
  const operationCalls: any[] = [];
  const sessions = {
    get: () => ({ id: 'ses_1', actor: 'oauth:ChatGPT', subject: 'grant_1' }),
    activeLease: () => ({
      workspaceId: 'ws_1',
      actor: 'oauth:ChatGPT',
      capabilities: ['files.read', 'files.search', 'files.write', 'files.delete'],
    }),
    isSwitching: () => false,
    isYolo: () => Boolean(options.yolo),
  } as any;
  const workspaces = {
    getLocal: () => ({ id: 'ws_1', name: 'Aevra', hostRoot: '/workspace' }),
    capabilityRoots: () => [],
  } as any;
  const worker = {
    async execute(input: any) {
      calls.push(input);
      const op = input.operation;
      if (op.kind === 'file.read') {
        if (op.path === '/.npmrc' || op.path === '/alias.txt') {
          return {
            ok: true,
            value: {
              path: options.downgradeSensitivePath ? '/normal.txt' : op.path,
              hash: 'sha256:test',
              content: '_authToken=[REDACTED]',
              ...(options.workerSensitivity ? { sensitivity: options.workerSensitivity } : {}),
            },
          };
        }
        const full = '0123456789';
        const offset = Number(op.offset ?? 0);
        const length = Number(op.length ?? full.length - offset);
        return {
          ok: true,
          value: {
            path: op.path,
            hash: 'chunkhash',
            content: full.slice(offset, offset + length),
            offset,
            length: Math.min(length, full.length - offset),
            totalLength: full.length,
          },
        };
      }
      return { ok: true, value: [] };
    },
  } as any;
  const approvals = {
    async request() {
      return { status: 'approval_pending', requestId: 'req_sensitive', expiresInSeconds: 60 };
    },
  } as any;
  const operations = {
    async write(...args: any[]) {
      operationCalls.push(args);
      return { path: String(args[1]?.path ?? '') };
    },
  } as any;
  const context: any = {
    sessions,
    workspaces,
    worker,
    reads: { put() {} },
    approvals,
    deps: {
      security: new SecurityGuard(sessions, workspaces),
      operations,
      approvals,
    },
    oneTimeCapabilities: new Set<string>(),
    callInner: async () => null,
    processStart: async () => null,
  };
  return { context, calls, operationCalls };
}

test('SECRET file_read is denied before Worker dispatch', async () => {
  const { context, calls } = fixture({ yolo: true });
  await assert.rejects(
    () => handleFileTool(context, 'ses_1', 'file_read', { path: '/.env' }),
    (error: any) => error?.code === 'CAPABILITY_REQUIRED',
  );
  assert.equal(calls.length, 0);
});

test('SENSITIVE file_read masks values before remote return', async () => {
  const { context } = fixture();
  const result: any = await handleFileTool(context, 'ses_1', 'file_read', { path: '/.npmrc' });
  assert.match(result.content, /_authToken/);
  assert.match(result.content, /\[REDACTED\]/);
  assert.equal(result.content.includes('raw-sensitive-value'), false);
});

test('requested sensitivity cannot be downgraded by a worker response path', async () => {
  const { context } = fixture({ downgradeSensitivePath: true });
  const result: any = await handleFileTool(context, 'ses_1', 'file_read', { path: '/.npmrc' });
  assert.equal(result.sensitivity, 'SENSITIVE');
  assert.match(result.content, /\[REDACTED\]/);
});

test('worker sensitivity elevation is preserved for alias reads', async () => {
  const { context } = fixture({ workerSensitivity: 'SENSITIVE' });
  const result: any = await handleFileTool(context, 'ses_1', 'file_read', { path: '/alias.txt' });
  assert.equal(result.sensitivity, 'SENSITIVE');
  assert.match(result.content, /\[REDACTED\]/);
});

test('ranged file_read forwards offset and length to Worker', async () => {
  const { context, calls } = fixture();
  const result: any = await handleFileTool(context, 'ses_1', 'file_read', {
    path: '/normal.txt',
    offset: 3,
    length: 4,
  });
  assert.equal(calls[0]?.operation.offset, 3);
  assert.equal(calls[0]?.operation.length, 4);
  assert.equal(result.content, '3456');
  assert.equal(result.offset, 3);
  assert.equal(result.length, 4);
  assert.equal(result.totalLength, 10);
});

test('SENSITIVE mutation requires one-time approval even in YOLO', async () => {
  const { context, operationCalls } = fixture({ yolo: true });
  const result: any = await handleFileTool(context, 'ses_1', 'file_write', {
    path: '/.npmrc',
    content: '_authToken=new-value',
  });
  assert.equal(result.status, 'approval_pending');
  assert.equal(result.requestId, 'req_sensitive');
  assert.equal(operationCalls.length, 0);
});
