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
  assert.match(
    state.logs.join('\n'),
    /u1\s+│\s+github\s+│\s+http\s+│\s+active\s+│\s+12 tools\s+│\s+HIGH/,
  );
  assert.equal(state.logs.join('\n').includes('sr_github'), false);
});
test('mcp list prints table with borders and headers when upstreams exist', async () => {
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
        },
      ],
    }),
  );
  await runMcpCommand({}, { command: 'mcp', action: 'list' }, state.dependencies);
  assert.equal(state.logs.length, 5);
  assert.ok(state.logs[0]!.startsWith('┌'));
  assert.match(state.logs[1]!, /ID\s+│\s+Name\s+│\s+Transport\s+│\s+State\s+│\s+Tools\s+│\s+Risk/);
  assert.ok(state.logs[2]!.startsWith('├'));
  assert.match(state.logs[3]!, /u1\s+│\s+github\s+│\s+http\s+│\s+active\s+│\s+12 tools\s+│\s+HIGH/);
  assert.ok(state.logs[4]!.startsWith('└'));
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

test('mcp auth failures do not misleadingly claim the runtime is stopped', async () => {
  const state = fixture(async () => {
    const error = new Error('Admin login rate limited; retry in 60s') as Error & { code?: string };
    error.code = 'ADMIN_LOGIN_RATE_LIMITED';
    throw error;
  });
  assert.equal(await runMcpCommand({}, { command: 'mcp', action: 'list' }, state.dependencies), 1);
  assert.equal(state.errors[0], '[aevra] mcp failed: Admin login rate limited; retry in 60s');
});

test('mcp connectivity failures still include the runtime hint', async () => {
  const state = fixture(async () => {
    const error = new Error('connect ECONNREFUSED') as Error & { code?: string };
    error.code = 'ECONNREFUSED';
    throw error;
  });
  assert.equal(await runMcpCommand({}, { command: 'mcp', action: 'list' }, state.dependencies), 1);
  assert.match(state.errors[0]!, /Is aevra start\/service running\?/);
});
