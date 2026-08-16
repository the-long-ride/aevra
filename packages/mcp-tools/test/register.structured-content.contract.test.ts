import assert from 'node:assert/strict';
import test from 'node:test';
import { handleJsonRpc } from '../src/register.js';

test('tools/call emits object structuredContent for array results', async () => {
  const service = { call: async () => [{ name: 'one' }, { name: 'two' }] } as any;
  const response: any = await handleJsonRpc(service, 'session', {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'file_list', arguments: { path: '/' } },
  });
  assert.deepEqual(response.result.structuredContent, {
    result: [{ name: 'one' }, { name: 'two' }],
  });
  assert.equal(response.result.content[0].text, JSON.stringify([{ name: 'one' }, { name: 'two' }]));
});

test('tools/call preserves object structuredContent without double wrapping', async () => {
  const service = { call: async () => ({ path: '/a.txt', content: 'hello' }) } as any;
  const response: any = await handleJsonRpc(service, 'session', {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: { name: 'file_read', arguments: { path: '/a.txt' } },
  });
  assert.deepEqual(response.result.structuredContent, { path: '/a.txt', content: 'hello' });
});

test('shell_run stays on the MCP service dispatch path', async () => {
  let called: any;
  const service = {
    call: async (sessionId: string, name: string, args: any) => {
      called = { sessionId, name, args };
      return { status: 'approval_pending', requestId: 'req_1' };
    },
  } as any;
  const response: any = await handleJsonRpc(service, 'session', {
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'shell_run', arguments: { script: 'pwd' } },
  });
  assert.equal(called.name, 'shell_run');
  assert.deepEqual(called.args, { script: 'pwd' });
  assert.deepEqual(response.result.structuredContent, {
    status: 'approval_pending',
    requestId: 'req_1',
  });
});

test('tools/list publishes closed input schemas and output schemas for every stable tool', async () => {
  const response: any = await handleJsonRpc({} as any, 'session', {
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/list',
  });
  assert.ok(response.result.tools.length > 0);
  for (const tool of response.result.tools) {
    assert.equal(tool.inputSchema?.type, 'object', `${tool.name} input schema missing`);
    assert.equal(
      tool.inputSchema?.additionalProperties,
      false,
      `${tool.name} input must be closed`,
    );
    assert.equal(tool.outputSchema?.type, 'object', `${tool.name} output schema missing`);
  }
});

test('process terminal result remains structured', async () => {
  const status = {
    processId: 'proc_1',
    pid: 42,
    startedAt: '2026-08-20T00:00:00.000Z',
    lifecycle: 'stop-with-aevra',
    state: 'completed',
    exitCode: 0,
    signal: null,
    finishedAt: '2026-08-20T00:00:01.000Z',
    durationMs: 1000,
  };
  const service = { call: async () => status } as any;
  const response: any = await handleJsonRpc(service, 'session', {
    jsonrpc: '2.0',
    id: 5,
    method: 'tools/call',
    params: { name: 'process_status', arguments: { processId: 'proc_1' } },
  });
  assert.deepEqual(response.result.structuredContent, status);
  assert.equal(response.result.content[0].text, JSON.stringify(status));
});

test('handleJsonRpc covers resources prompts and unknown methods', async () => {
  const service = {
    resourcesList: () => ({ resources: [{ uri: 'aevra://res/1' }] }),
    resourceRead: async (_s: string, uri: string) => {
      if (uri === 'fail') throw new Error('resource failed');
      return { contents: [{ uri, text: 'data' }] };
    },
    promptsList: () => ({ prompts: [{ name: 'prompt1' }] }),
    promptGet: async () => ({ messages: [] }),
    call: async () => {
      throw new Error('call failed');
    },
  } as any;

  const rList: any = await handleJsonRpc(service, 's', { method: 'resources/list', id: 1 });
  assert.equal(rList.result.resources.length, 1);

  const rRead: any = await handleJsonRpc(service, 's', {
    method: 'resources/read',
    id: 2,
    params: { uri: 'aevra://res/1' },
  });
  assert.equal(rRead.result.contents[0].text, 'data');

  const rFail: any = await handleJsonRpc(service, 's', {
    method: 'resources/read',
    id: 3,
    params: { uri: 'fail' },
  });
  assert.equal(rFail.result.isError, true);

  const pList: any = await handleJsonRpc(service, 's', { method: 'prompts/list', id: 4 });
  assert.equal(pList.result.prompts.length, 1);

  const pGet: any = await handleJsonRpc(service, 's', { method: 'prompts/get', id: 5 });
  assert.deepEqual(pGet.result.messages, []);

  const failingPromptService = {
    promptGet: async () => {
      throw new Error('prompt failed');
    },
  } as any;
  const pFail: any = await handleJsonRpc(failingPromptService, 's', {
    method: 'prompts/get',
    id: 6,
  });
  assert.equal(pFail.result.isError, true);

  const unknown: any = await handleJsonRpc(service, 's', { method: 'unknown/method', id: 7 });
  assert.equal(unknown.error.code, -32601);

  const callError: any = await handleJsonRpc(service, 's', {
    method: 'tools/call',
    id: 8,
    params: { name: 'failing_tool' },
  });
  assert.equal(callError.result.isError, true);
});
