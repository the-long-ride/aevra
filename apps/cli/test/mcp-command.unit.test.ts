import assert from 'node:assert/strict';
import test from 'node:test';
import { runMcpCommand } from '../src/commands/mcp-command.js';
function response(body: unknown = {}, ok = true, status = 200) {
  return {
    ok,
    status,
    async json() {
      return body;
    },
  };
}
function fixture(
  api: (config: object, path: string, init?: any) => Promise<ReturnType<typeof response>>,
) {
  const logs: string[] = [],
    errors: string[] = [],
    calls: any[] = [];
  return {
    logs,
    errors,
    calls,
    dependencies: {
      api: (config: object, path: string, init?: any) => {
        calls.push({ path, init });
        return api(config, path, init);
      },
      log: (message: string) => logs.push(message),
      error: (message: string) => errors.push(message),
      formatError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
    },
  };
}
test('mcp list prints empty state', async () => {
  const state = fixture(async () => response({ upstreams: [] }));
  assert.equal(await runMcpCommand({}, { command: 'mcp', action: 'list' }, state.dependencies), 0);
  assert.deepEqual(state.logs, ['No MCP servers registered.']);
});
test('mcp list prints summary without credentials', async () => {
  const state = fixture(async () =>
    response({
      upstreams: [
        {
          id: 'u1',
          name: 'github',
          state: 'active',
          toolCount: 12,
          risk: 'HIGH',
          transport: 'http',
          auth: { secretRefId: 'sr_github' },
        },
      ],
    }),
  );
  await runMcpCommand({}, { command: 'mcp', action: 'list' }, state.dependencies);
  assert.match(state.logs[0]!, /u1\s+github\s+http\s+active\s+12 tools\s+HIGH/);
  assert.equal(state.logs.join('\n').includes('sr_github'), false);
});
test('mcp add posts http and stdio registration bodies', async () => {
  const state = fixture(async () => response({ id: 'u1', name: 'github', toolCount: 12 }));
  await runMcpCommand(
    {},
    {
      command: 'mcp',
      action: 'add',
      name: 'github',
      transport: 'http',
      url: 'https://mcp.example.com/mcp',
      header: 'Authorization',
      secretRef: 'sr_github',
      risk: 'HIGH',
      args: [],
      env: {},
    },
    state.dependencies,
  );
  assert.deepEqual(JSON.parse(state.calls[0].init.body), {
    name: 'github',
    transport: 'http',
    config: { url: 'https://mcp.example.com/mcp' },
    auth: { header: 'Authorization', secretRefId: 'sr_github' },
    risk: 'HIGH',
  });
});
test('mcp test and remove use their endpoints', async () => {
  const state = fixture(async () =>
    response({ ok: true, serverName: 'github-mcp', serverVersion: '1.2.3', toolCount: 12 }),
  );
  assert.equal(
    await runMcpCommand({}, { command: 'mcp', action: 'test', id: 'u1' }, state.dependencies),
    0,
  );
  assert.equal(state.calls[0].path, '/api/mcp/upstreams/u1/test');
  assert.equal(
    await runMcpCommand({}, { command: 'mcp', action: 'remove', id: 'u1' }, state.dependencies),
    0,
  );
  assert.equal(state.calls[1].init.method, 'DELETE');
});
test('a failed registration or test returns nonzero', async () => {
  const failed = fixture(async () =>
    response({ error: { message: 'initialize never completed' } }, false, 400),
  );
  assert.equal(
    await runMcpCommand(
      {},
      {
        command: 'mcp',
        action: 'add',
        name: 'broken',
        transport: 'http',
        url: 'https://broken.test/mcp',
        risk: 'LOW',
      },
      failed.dependencies,
    ),
    1,
  );
  const testFailure = fixture(async () => response({ ok: false, message: 'connection refused' }));
  assert.equal(
    await runMcpCommand({}, { command: 'mcp', action: 'test', id: 'u1' }, testFailure.dependencies),
    1,
  );
});
