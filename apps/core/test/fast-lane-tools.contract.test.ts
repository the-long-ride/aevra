import assert from 'node:assert/strict';
import test from 'node:test';
import { AevraToolError } from '../../../packages/mcp-tools/src/errors.js';
import { handleFastLaneTool } from '../../../packages/mcp-tools/src/fast-lane-tools.js';
import { toolDefinitions } from '../../../packages/mcp-tools/src/registry.js';

function context(callInner: (sessionId: string, name: string, args: any) => Promise<any>) {
  return { callInner } as any;
}

test('registry exposes Fast Lane tools with model-facing hints and schemas', () => {
  const definitions = new Map(toolDefinitions().map((tool) => [tool.name, tool]));
  for (const name of ['file_read_many', 'file_write_many', 'command_run_many'] as const) {
    const tool = definitions.get(name);
    assert.ok(tool, name);
    assert.match(tool.description, /FAST PATH/);
    assert.ok(Array.isArray(tool.inputSchema.required));
  }
  assert.equal(definitions.get('file_read_many')?.annotations.readOnlyHint, true);
  assert.equal(definitions.get('command_run_many')?.annotations.openWorldHint, true);
});

test('file_read_many preserves input order, target, and per-item failures', async () => {
  const calls: any[] = [];
  const result = await handleFastLaneTool(
    context(async (sessionId, name, args) => {
      calls.push({ sessionId, name, args });
      if (args.path === 'b.ts') {
        throw Object.assign(new Error('missing'), { code: 'RESOURCE_NOT_FOUND' });
      }
      await new Promise<void>((resolve) => setImmediate(resolve));
      return { path: args.path, content: args.path };
    }),
    'session-1',
    'file_read_many',
    {
      workspaceId: 'ws-1',
      concurrency: 2,
      reads: [{ path: 'a.ts' }, { path: 'b.ts' }, { path: 'c.ts' }],
    },
  );

  assert.equal(result.count, 3);
  assert.equal(result.succeeded, 2);
  assert.equal(result.failed, 1);
  assert.deepEqual(
    result.results.map((item: any) => item.path),
    ['a.ts', 'b.ts', 'c.ts'],
  );
  assert.equal(result.results[1]?.error?.code, 'RESOURCE_NOT_FOUND');
  assert.equal(calls.length, 3);
  assert.ok(calls.every((call) => call.name === 'file_read'));
  assert.ok(calls.every((call) => call.args.workspaceId === 'ws-1'));
});

test('file_write_many rejects duplicate paths before dispatch', async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      handleFastLaneTool(
        context(async () => {
          calls += 1;
        }),
        'session-1',
        'file_write_many',
        {
          writes: [
            { operation: 'replace', path: 'src/a.ts', content: 'one' },
            { operation: 'patch', path: 'src/a.ts', patch: '@@ -1 +1 @@\n-a\n+b' },
          ],
        },
      ),
    (error: unknown) =>
      error instanceof AevraToolError &&
      error.code === 'INVALID_REQUEST' &&
      /Duplicate write target/.test(error.message),
  );
  assert.equal(calls, 0);
});

test('file_write_many delegates create, replace, and patch to singular secure tools', async () => {
  const calls: any[] = [];
  const result = await handleFastLaneTool(
    context(async (sessionId, name, args) => {
      calls.push({ sessionId, name, args });
      return { accepted: true };
    }),
    'session-1',
    'file_write_many',
    {
      workspace: 'Aevra',
      concurrency: 3,
      writes: [
        { operation: 'create', path: 'a.ts', content: 'a', encoding: 'utf8' },
        { operation: 'replace', path: 'b.ts', content: 'b', expectedHash: 'hash-b' },
        { operation: 'patch', path: 'c.ts', patch: '@@ -1 +1 @@\n-c\n+C', expectedHash: 'hash-c' },
      ],
    },
  );

  assert.equal(result.succeeded, 3);
  const byPath = new Map(calls.map((call) => [call.args.path, call]));
  assert.equal(byPath.get('a.ts')?.name, 'file_create');
  assert.equal(byPath.get('b.ts')?.name, 'file_write');
  assert.equal(byPath.get('c.ts')?.name, 'file_patch');
  assert.equal(byPath.get('b.ts')?.args.expectedHash, 'hash-b');
  assert.equal(byPath.get('c.ts')?.args.expectedHash, 'hash-c');
  assert.ok(calls.every((call) => call.args.workspace === 'Aevra'));
});

async function commandConcurrency(strategy: 'auto' | 'parallel' | 'sequential', limit: number) {
  let active = 0;
  let maximum = 0;
  const result = await handleFastLaneTool(
    context(async (_sessionId, name, args) => {
      assert.equal(name, 'command_run');
      assert.equal(args.workspaceId, 'ws-1');
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise<void>((resolve) => setImmediate(resolve));
      active -= 1;
      return { exitCode: 0 };
    }),
    'session-1',
    'command_run_many',
    {
      workspaceId: 'ws-1',
      strategy,
      concurrency: limit,
      commands: [
        { executable: 'npm', args: ['run', 'lint'] },
        { executable: 'npm', args: ['run', 'typecheck'] },
        { executable: 'npm', args: ['test'] },
      ],
    },
  );
  assert.equal(result.succeeded, 3);
  return maximum;
}

test('command_run_many supports sequential and bounded concurrent scheduling', async () => {
  assert.equal(await commandConcurrency('sequential', 4), 1);
  assert.equal(await commandConcurrency('parallel', 2), 2);
  assert.ok((await commandConcurrency('auto', 4)) > 1);
});
