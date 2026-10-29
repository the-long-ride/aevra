import assert from 'node:assert/strict';
import test from 'node:test';
import { handleJsonRpc } from '../src/register.js';
import { McpToolService } from '../src/service.js';
import { assertToolEnabled, disabledToolNames, isToolLocked } from '../src/tool-switches.js';
import { toolGroupOf } from '../src/tool-groups.js';

function settings(names: unknown) {
  return { get: (_key: string, fallback: unknown) => (names === undefined ? fallback : names) };
}

function rpc(method: string, params?: unknown) {
  return { jsonrpc: '2.0', id: 1, method, ...(params === undefined ? {} : { params }) };
}

function fakeService(disabled: string[]) {
  const called: string[] = [];
  const service = {
    disabledToolNames: () => new Set(disabled.filter((n) => !isToolLocked(n))),
    upstreamToolDefinitions: async () => [
      { name: 'blender__look', description: 'x', inputSchema: { type: 'object' } },
      { name: 'blender__other', description: 'x', inputSchema: { type: 'object' } },
    ],
    call: async (_s: string, name: string) => {
      called.push(name);
      return { ok: true };
    },
  } as any;
  return { service, called };
}

test('files_ prefix belongs to the files group', () => {
  assert.equal(toolGroupOf('files_download'), 'files');
  assert.equal(toolGroupOf('files_upload'), 'files');
});

test('locked tools are the core group', () => {
  assert.equal(isToolLocked('workspace_select'), true);
  assert.equal(isToolLocked('aevra_status'), true);
  assert.equal(isToolLocked('git_status'), false);
  assert.equal(isToolLocked('blender__look'), false);
});

test('disabledToolNames reads the setting and drops locked names and junk', () => {
  assert.deepEqual(disabledToolNames(undefined).size, 0);
  assert.equal(disabledToolNames(settings(undefined) as any).size, 0);
  assert.equal(disabledToolNames(settings('bad') as any).size, 0);
  assert.equal(disabledToolNames(settings({ names: 'bad' }) as any).size, 0);
  const set = disabledToolNames(
    settings({ names: ['git_status', 'aevra_status', 7, 'blender__look'] }) as any,
  );
  assert.deepEqual([...set].sort(), ['blender__look', 'git_status']);
});

test('assertToolEnabled throws TOOL_DISABLED', () => {
  assert.doesNotThrow(() => assertToolEnabled('git_status', new Set()));
  assert.throws(
    () => assertToolEnabled('git_status', new Set(['git_status'])),
    (e: any) =>
      e.code === 'TOOL_DISABLED' &&
      e.message === 'Tool git_status is turned off in Settings > Tools.',
  );
});

test('tools/list omits disabled built-in and upstream tools, never a locked one', async () => {
  const { service } = fakeService(['git_status', 'blender__look', 'aevra_status']);
  const response: any = await handleJsonRpc(service, 's1', rpc('tools/list'));
  const names = response.result.tools.map((t: any) => t.name);
  assert.ok(!names.includes('git_status'));
  assert.ok(!names.includes('blender__look'));
  assert.ok(names.includes('blender__other'));
  assert.ok(names.includes('aevra_status'));
  assert.ok(names.includes('git_log'));
});

test('tools/call on a disabled name is TOOL_DISABLED', async () => {
  const { service, called } = fakeService(['git_status']);
  const response: any = await handleJsonRpc(
    service,
    's1',
    rpc('tools/call', { name: 'git_status', arguments: {} }),
  );
  assert.equal(response.result.isError, true);
  assert.match(response.result.content[0].text, /TOOL_DISABLED/);
  assert.deepEqual(called, []);
});

test('resources/list and prompts/list are unchanged by switches', async () => {
  const { service } = fakeService(['git_status']);
  (service as any).resourcesList = async () => ({ resources: [{ uri: 'a' }] });
  (service as any).promptsList = async () => ({ prompts: [{ name: 'p' }] });
  const r: any = await handleJsonRpc(service, 's1', rpc('resources/list'));
  const p: any = await handleJsonRpc(service, 's1', rpc('prompts/list'));
  assert.equal(r.result.resources.length, 1);
  assert.equal(p.result.prompts.length, 1);
});

function hookedService(disabled: string[]) {
  const sessions = {
    get: () => ({ id: 's1', actor: 'oauth:user', subject: 'user' }),
    touch() {},
    activeLease: () => null,
  } as any;
  const worker = {
    execute: async (input: any) =>
      input.operation?.kind === 'hook.run'
        ? {
            ok: true,
            value: {
              exitCode: 0,
              stdout: JSON.stringify({
                action: 'modify',
                payload: { name: 'git_status', args: {} },
              }),
            },
          }
        : { ok: true, value: {} },
  } as any;
  const hook = {
    id: 'rewrite',
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
  };
  return new McpToolService(sessions, {} as any, worker, { put() {} } as any, undefined, {
    settings: {
      get: (key: string, fallback: unknown) =>
        key === 'hooks.config' ? [hook] : key === 'tools.disabled' ? { names: disabled } : fallback,
    } as any,
  });
}

test('hook rewrite to disabled tool refused', async () => {
  const service = hookedService(['git_status']);
  await assert.rejects(
    () => service.call('s1', 'aevra_status', {}),
    (e: any) => e.code === 'TOOL_DISABLED' && /git_status/.test(e.message),
  );
});

test('service.call refuses a disabled name directly', async () => {
  const service = hookedService(['aevra_status', 'file_list']);
  await assert.rejects(
    () => service.call('s1', 'file_list', {}),
    (e: any) => e.code === 'TOOL_DISABLED',
  );
});

test('batch tools cannot reach a disabled inner tool through callInner', async () => {
  const { makeHarness } = await import('./transfer-harness.js');
  const h = makeHarness({ yolo: 'do-whatever', disabled: ['file_read', 'command_run'] });
  try {
    const read: any = await h.service.call('s1', 'file_read_many', {
      workspaceId: 'w1',
      reads: [{ path: '/a.txt' }],
    });
    assert.equal(read.results[0].error.code, 'TOOL_DISABLED');
    const run: any = await h.service.call('s1', 'command_run_many', {
      workspaceId: 'w1',
      commands: [{ executable: 'echo', args: ['hi'] }],
    });
    assert.equal(run.results[0].error.code, 'TOOL_DISABLED');
  } finally {
    h.close();
  }
});

test('resume of an approval for a tool disabled after the request is refused', async () => {
  const { makeHarness } = await import('./transfer-harness.js');
  const disabled: string[] = [];
  const h = makeHarness({ disabled });
  try {
    const pending: any = await h.service.call('s1', 'files_download', {
      workspaceId: 'w1',
      entries: [
        {
          path: '/in/a.txt',
          mimeType: 'text/plain',
          encoding: 'base64',
          content: Buffer.from('words').toString('base64'),
        },
      ],
    });
    assert.equal(pending.status, 'approval_pending');
    disabled.push('files_download');
    h.approvals.approve(pending.requestId, 'once');
    const done: any = await h.service
      .call('s1', 'approval_wait', { requestId: pending.requestId })
      .catch((e: any) => ({ thrown: e.code }));
    assert.ok(JSON.stringify(done).includes('TOOL_DISABLED'), JSON.stringify(done));
    assert.equal(h.files.has('/in/a.txt'), false);
  } finally {
    h.close();
  }
});
