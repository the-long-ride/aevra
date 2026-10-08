import assert from 'node:assert/strict';
import test from 'node:test';
import { handleJsonRpc } from '../src/register.js';

const upstreamTool = {
  name: 'github__search',
  description: 'Search.',
  inputSchema: { type: 'object', properties: {} },
};
const service = {
  upstreamToolDefinitions: async () => [upstreamTool],
  call: async (_session: string, name: string) => {
    if (name === 'shell_run') return { exitCode: 0, signal: null, stdout: 'ok\r\n', stderr: '' };
    return { entries: [] };
  },
} as any;

function rpc(method: string, params?: unknown) {
  return { jsonrpc: '2.0', id: 1, method, ...(params === undefined ? {} : { params }) };
}

test('tools/list advertises the compact list', async () => {
  const response: any = await handleJsonRpc(service, 's1', rpc('tools/list'));
  assert.equal(response.result.tools.length > 60, true);
  const upstreamSize = JSON.stringify(upstreamTool).length;
  assert.ok(JSON.stringify(response.result.tools).length <= 54_000 + upstreamSize + 2);
});

test('tools/list honours the connector profile and hides upstream when its group is off', async () => {
  const response: any = await handleJsonRpc(service, 's1', rpc('tools/list'), undefined, {
    profile: { toolGroups: ['files'] },
  });
  const names = response.result.tools.map((t: any) => t.name);
  assert.ok(names.includes('file_list') && names.includes('approval_wait'));
  assert.ok(!names.includes('git_status') && !names.includes('github__search'));
});

test('tools/list keeps upstream tools when the upstream group is on', async () => {
  const response: any = await handleJsonRpc(service, 's1', rpc('tools/list'), undefined, {
    profile: { toolGroups: ['upstream'] },
  });
  assert.ok(response.result.tools.some((t: any) => t.name === 'github__search'));
});

test('a call to a disabled group is a tool error, not a transport error', async () => {
  const response: any = await handleJsonRpc(
    service,
    's1',
    rpc('tools/call', { name: 'git_status', arguments: {} }),
    undefined,
    { profile: { toolGroups: ['files'] } },
  );
  assert.equal(response.error, undefined);
  assert.equal(response.result.isError, true);
  assert.match(response.result.content[0].text, /TOOL_GROUP_DISABLED/);
});

test('results are shaped and the saving is reported', async () => {
  let saved = 0;
  const response: any = await handleJsonRpc(
    service,
    's1',
    rpc('tools/call', { name: 'shell_run', arguments: {} }),
    undefined,
    {
      onSaved: (chars) => {
        saved = chars;
      },
    },
  );
  assert.deepEqual(JSON.parse(response.result.content[0].text), { exitCode: 0, stdout: 'ok\n' });
  assert.ok(saved > 0);
});

test('resultFormat text omits structuredContent', async () => {
  const response: any = await handleJsonRpc(
    service,
    's1',
    rpc('tools/call', { name: 'file_list', arguments: {} }),
    '2025-06-18',
    { profile: { resultFormat: 'text' } },
  );
  assert.equal(response.result.structuredContent, undefined);
  assert.equal(JSON.parse(response.result.content[0].text).entries.length, 0);
});

test('resultFormat structured sends a one-line text pointer', async () => {
  const response: any = await handleJsonRpc(
    service,
    's1',
    rpc('tools/call', { name: 'file_list', arguments: {} }),
    '2025-06-18',
    { profile: { resultFormat: 'structured' } },
  );
  assert.equal(response.result.content[0].text, 'See structuredContent.');
  assert.ok(response.result.structuredContent);
});

test('default format keeps both channels', async () => {
  const response: any = await handleJsonRpc(
    service,
    's1',
    rpc('tools/call', { name: 'file_list', arguments: {} }),
    '2025-06-18',
  );
  assert.ok(response.result.structuredContent);
  assert.ok(JSON.parse(response.result.content[0].text));
});
