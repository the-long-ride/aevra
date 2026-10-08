import assert from 'node:assert/strict';
import test from 'node:test';
import { McpToolService } from '../src/service.js';

function service(options: { known?: boolean; hookControl?: Record<string, unknown> } = {}) {
  const records: Array<[string, number]> = [];
  const lease = {
    workspaceId: 'w1',
    capabilities: ['files.read', 'skills.read'],
  };
  const sessions = {
    get: () =>
      options.known === false ? null : { id: 's1', actor: 'oauth:user', subject: 'user' },
    touch() {},
    activeLease: () => lease,
  } as any;
  const workspaces = {
    listRemote: () => [{ id: 'w1', name: 'Aevra', description: '' }],
    getLocal: () => ({
      id: 'w1',
      name: 'Aevra',
      description: '',
      hostRoot: '/x',
    }),
  } as any;
  const worker = {
    execute: async (input: any) => {
      if (input.operation?.kind === 'hook.run') {
        return {
          ok: true,
          value: {
            exitCode: 0,
            stdout: options.hookControl ? JSON.stringify(options.hookControl) : '',
          },
        };
      }
      return { ok: true, value: {} };
    },
  } as any;
  const reads = { put() {} } as any;
  const instance = new McpToolService(sessions, workspaces, worker, reads, undefined, {
    skills: { list: () => [], instructions: () => ({ instructions: [] }) } as any,
    permissions: {
      summary: () => ({
        effectiveCapabilities: ['files.read', 'files.search'],
        commandMatchers: ['git:status'],
      }),
    } as any,
    ...(options.hookControl
      ? {
          settings: {
            get: (key: string, fallback: unknown) =>
              key === 'hooks.config'
                ? [
                    {
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
                    },
                  ]
                : fallback,
          } as any,
        }
      : {}),
    metrics: {
      record: (name, ms) => records.push([name, ms]),
    },
  });
  return { instance, records };
}

test('unknown sessions remain unauthorized', async () => {
  const { instance, records } = service({ known: false });
  await assert.rejects(
    () => instance.call('missing', 'aevra_status'),
    (error: any) => {
      assert.equal(error.code, 'UNAUTHORIZED');
      return true;
    },
  );
  assert.equal(records.length, 1);
  assert.equal(records[0]![0], 'aevra_status');
});

test('status dispatch preserves effective capability summary', async () => {
  const { instance, records } = service();
  const result = await instance.call('s1', 'aevra_status');
  assert.deepEqual(result.effectiveCapabilities, ['files.read', 'files.search']);
  assert.deepEqual(result.commandMatchers, ['git:status']);
  assert.equal(result.workspace.id, 'w1');
  assert.equal(records.length, 1);
});

test('transformed tool input is dispatched through normal authorization again', async () => {
  const { instance } = service({
    hookControl: { action: 'modify', payload: { name: 'missing_tool', args: {} } },
  });
  await assert.rejects(
    () => instance.call('s1', 'aevra_status'),
    (error: any) => {
      assert.equal(error.code, 'CAPABILITY_REQUIRED');
      assert.match(error.message, /missing_tool/);
      return true;
    },
  );
});

test('service resources and prompts surface dispatch', async () => {
  const { instance } = service();
  assert.deepEqual(await instance.resourcesList('s1'), { resources: [] });
  assert.ok((await instance.promptsList()).prompts.length > 0);
  const prompt = (await instance.promptGet('s1')) as any;
  assert.ok(prompt.messages);
});

test('connector profile rejects a disabled tool produced by a hook through the skill gate', async () => {
  const { handleJsonRpc } = await import('../src/register.js');
  const { SessionSkillAccessGate } = await import('../src/skill-access-gate.js');
  const { instance } = service({
    hookControl: { action: 'modify', payload: { name: 'skills_list', args: {} } },
  });
  const gate = new SessionSkillAccessGate(instance, {} as any, {} as any);
  const response: any = await handleJsonRpc(
    gate as any,
    's1',
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'aevra_status', arguments: {} },
    },
    undefined,
    { profile: { toolGroups: ['files'] } },
  );
  assert.equal(response.result.isError, true);
  assert.equal(JSON.parse(response.result.content[0].text).error.code, 'TOOL_GROUP_DISABLED');
});
