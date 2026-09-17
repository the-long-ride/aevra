import assert from 'node:assert/strict';
import test from 'node:test';
import { handleJsonRpc } from '../src/register.js';
import { toolDefinitions } from '../src/registry.js';
import { SessionSkillAccessGate } from '../src/skill-access-gate.js';
import { upstreamService } from './upstream-context.js';

test('tools/list concatenates the built-in list with the cached upstream list', async () => {
  const { service } = upstreamService();
  const response: any = await handleJsonRpc(service as any, 's1', {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/list',
  });
  const names = response.result.tools.map((tool: any) => tool.name);
  assert.equal(response.result.tools.length, toolDefinitions().length + 1);
  assert.ok(names.includes('aevra_status'));
  assert.ok(names.includes('github__search'));
});

test('tools/list is identical for every session id', async () => {
  const { service } = upstreamService();
  const first: any = await handleJsonRpc(service as any, 'session-a', {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/list',
  });
  const second: any = await handleJsonRpc(service as any, 'session-b', {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/list',
  });
  assert.deepEqual(first.result, second.result);
});

test('tools/list survives a service with no upstream surface at all', async () => {
  const response: any = await handleJsonRpc({} as any, 's1', {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/list',
  });
  assert.equal(response.result.tools.length, toolDefinitions().length);
});

test('resources/list merges local skill resources with proxied entries', async () => {
  const { service } = upstreamService();
  const response: any = await handleJsonRpc(service as any, 's1', {
    jsonrpc: '2.0',
    id: 1,
    method: 'resources/list',
  });
  assert.deepEqual(
    response.result.resources.map((resource: any) => resource.uri),
    ['mcp+github://repo://readme'],
  );
});

test('resources/read routes an mcp+ URI to the upstream and other URIs to skills', async () => {
  const { service, calls } = upstreamService();
  const proxiedRead: any = await handleJsonRpc(service as any, 's1', {
    jsonrpc: '2.0',
    id: 1,
    method: 'resources/read',
    params: { uri: 'mcp+github://repo://readme' },
  });
  assert.equal(proxiedRead.result.uri, 'mcp+github://repo://readme');
  assert.equal(proxiedRead.result.untrusted, true);
  assert.equal(calls.length, 1);
  const skillRead: any = await handleJsonRpc(service as any, 's1', {
    jsonrpc: '2.0',
    id: 2,
    method: 'resources/read',
    params: { uri: 'aevra://skill/user/writing' },
  });
  assert.equal(skillRead.result.isError, true);
  assert.match(skillRead.result.content[0].text, /SKILL_NOT_FOUND/);
  assert.equal(calls.length, 1, 'a skill URI reached the upstream');
});

test('the skill access gate passes an mcp+ URI through to the proxy', async () => {
  const { service, calls } = upstreamService();
  const gate = new SessionSkillAccessGate(
    service,
    { activeLease: () => null, isYolo: () => false, get: () => ({ id: 's1' }) } as any,
    { list: () => [], status: () => null, request: async () => ({}) } as any,
  );
  const result: any = await gate.resourceRead('s1', 'mcp+github://repo://readme');
  assert.equal(result.uri, 'mcp+github://repo://readme');
  assert.equal(calls.length, 1);
});

test('prompts/list includes the built-in prompt and the proxied ones', async () => {
  const { service } = upstreamService();
  const response: any = await handleJsonRpc(service as any, 's1', {
    jsonrpc: '2.0',
    id: 1,
    method: 'prompts/list',
  });
  assert.deepEqual(
    response.result.prompts.map((prompt: any) => prompt.name),
    ['aevra-instructions', 'github__triage'],
  );
});

test('prompts/get routes a namespaced name upstream and the built-in name locally', async () => {
  const { service, calls } = upstreamService();
  const proxiedGet: any = await handleJsonRpc(service as any, 's1', {
    jsonrpc: '2.0',
    id: 1,
    method: 'prompts/get',
    params: { name: 'github__triage', arguments: { issue: '42' } },
  });
  assert.equal(proxiedGet.result.untrusted, true);
  assert.deepEqual(calls, [
    { kind: 'prompt', server: 'github', entry: 'triage', args: { issue: '42' } },
  ]);
  const localGet: any = await handleJsonRpc(service as any, 's1', {
    jsonrpc: '2.0',
    id: 2,
    method: 'prompts/get',
    params: { name: 'aevra-instructions' },
  });
  assert.ok(localGet.result.messages);
  assert.equal(calls.length, 1, 'the built-in prompt reached the upstream');
});
