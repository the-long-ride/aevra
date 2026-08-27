import assert from 'node:assert/strict';
import test from 'node:test';
import { aevraServerInfo } from '../src/mcp/server-info.js';
import { AevraToolError } from '../../../packages/mcp-tools/src/errors.js';
import { handleFastLaneTool } from '../../../packages/mcp-tools/src/fast-lane-tools.js';
import { handleJsonRpc } from '../../../packages/mcp-tools/src/register.js';
import { toolDefinitions } from '../../../packages/mcp-tools/src/registry.js';

const hiddenSingularTools = [
  'file_read',
  'file_create',
  'file_write',
  'file_patch',
  'command_run',
] as const;
const fastLaneTools = ['file_read_many', 'file_write_many', 'command_run_many'] as const;

function context(callInner: (sessionId: string, name: string, args: any) => Promise<any>) {
  return { callInner } as any;
}

test('server and public tool descriptions describe capability without selection instructions', () => {
  assert.doesNotMatch(aevraServerInfo().description, /Fast Lane|_many/i);

  const definitions = new Map(toolDefinitions().map((tool) => [tool.name, tool]));
  for (const name of fastLaneTools) {
    const tool = definitions.get(name);
    assert.ok(tool, name);
    assert.doesNotMatch(tool.description, /FAST PATH|default model-facing/i);
  }
});

test('file_write_many publishes an operation-discriminated write schema', () => {
  const writeTool = toolDefinitions().find((tool) => tool.name === 'file_write_many');
  assert.ok(writeTool);
  const writes = (writeTool.inputSchema as any).properties?.writes;
  assert.equal(Array.isArray(writes?.items?.oneOf), true);
  assert.equal(writes.items.oneOf.length, 3);
  assert.deepEqual(
    writes.items.oneOf.map((variant: any) => variant.properties?.operation?.const),
    ['create', 'replace', 'patch'],
  );
});

test('file_write_many rejects fields that do not belong to the selected operation', async () => {
  let calls = 0;
  const invalidWrites = [
    {
      write: { operation: 'create', path: 'a.ts', content: 'a', expectedHash: 'hash' },
      field: 'expectedHash',
    },
    {
      write: { operation: 'replace', path: 'b.ts', content: 'b', encoding: 'base64' },
      field: 'encoding',
    },
    {
      write: { operation: 'patch', path: 'c.ts', patch: '@@ -1 +1 @@\n-c\n+C', content: 'c' },
      field: 'content',
    },
  ] as const;

  for (const { write, field } of invalidWrites) {
    await assert.rejects(
      () =>
        handleFastLaneTool(
          context(async () => {
            calls += 1;
            return { accepted: true };
          }),
          'session-1',
          'file_write_many',
          { writes: [write] },
        ),
      (error: unknown) =>
        error instanceof AevraToolError &&
        error.code === 'INVALID_REQUEST' &&
        error.message.includes(field),
    );
  }
  assert.equal(calls, 0);
});

test('MCP tools/list exposes Fast Lane tools and hides singular execution primitives', async () => {
  const response = (await handleJsonRpc({} as any, 'session-1', {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/list',
  })) as any;
  const names = new Set(response.result.tools.map((tool: any) => tool.name));

  for (const name of hiddenSingularTools) assert.equal(names.has(name), false, name);
  for (const name of fastLaneTools) assert.equal(names.has(name), true, name);
});
