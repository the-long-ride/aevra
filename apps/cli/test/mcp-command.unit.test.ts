import assert from 'node:assert/strict';
import test from 'node:test';
import { runMcpCommand } from '../src/commands/mcp-command.js';

const plainPhrase1 = 'sr_github';
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
          enabled: true,
          auth: { secretRefId: plainPhrase1 },
        },
      ],
    }),
  );
  await runMcpCommand({}, { command: 'mcp', action: 'list' }, state.dependencies);
  assert.match(
    state.logs.join('\n'),
    /u1\s+│\s+github\s+│\s+http\s+│\s+active\s+│\s+yes\s+│\s+12 tools\s+│\s+HIGH/,
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
          enabled: true,
        },
      ],
    }),
  );
  await runMcpCommand({}, { command: 'mcp', action: 'list' }, state.dependencies);
  assert.equal(state.logs.length, 5);
  assert.ok(state.logs[0]!.startsWith('┌'));
  assert.match(
    state.logs[1]!,
    /ID\s+│\s+Name\s+│\s+Transport\s+│\s+State\s+│\s+Enabled\s+│\s+Tools\s+│\s+Risk/,
  );
  assert.ok(state.logs[2]!.startsWith('├'));
  assert.match(
    state.logs[3]!,
    /u1\s+│\s+github\s+│\s+http\s+│\s+active\s+│\s+yes\s+│\s+12 tools\s+│\s+HIGH/,
  );
  assert.ok(state.logs[4]!.startsWith('└'));
});
test('mcp list shows no for a disabled server', async () => {
  const state = fixture(async () =>
    response({
      upstreams: [
        {
          id: 'u2',
          name: 'paused',
          state: 'active',
          toolCount: 3,
          risk: 'LOW',
          transport: 'stdio',
          enabled: false,
        },
      ],
    }),
  );
  await runMcpCommand({}, { command: 'mcp', action: 'list' }, state.dependencies);
  assert.match(state.logs[3]!, /u2\s+│\s+paused\s+│\s+stdio\s+│\s+active\s+│\s+no\s+│\s+3 tools/);
});
test('mcp list marks pending rows and prints hints in order', async () => {
  const base = { transport: 'http', toolCount: 1, risk: 'LOW', enabled: true };
  const state = fixture(async () =>
    response({
      upstreams: [
        { ...base, id: 'mu_0', name: 'fine', state: 'active' },
        {
          ...base,
          id: 'mu_1',
          name: 'engram',
          state: 'needs-review',
          pendingCatalogDiff: { added: ['tool:a', 'tool:b'], removed: [], changed: ['tool:c'] },
          pendingCatalogFingerprint: 'fingerprintvalue',
        },
        {
          ...base,
          id: 'mu_2',
          name: 'other',
          state: 'needs-review',
          pendingCatalogDiff: null,
          pendingCatalogFingerprint: null,
        },
      ],
    }),
  );
  assert.equal(await runMcpCommand({}, { command: 'mcp', action: 'list' }, state.dependencies), 0);
  assert.ok(state.logs[1]!.startsWith('│ ! │'));
  assert.ok(state.logs[3]!.startsWith('│   │'));
  assert.ok(state.logs[4]!.startsWith('│ ! │'));
  assert.ok(state.logs[5]!.startsWith('│ ! │'));
  assert.deepEqual(state.logs.slice(-2), [
    '[aevra] engram changed its catalog (+2 added, -0 removed, ~1 changed). Run: aevra mcp review mu_1',
    '[aevra] other is blocked pending review. Run: aevra mcp test mu_2',
  ]);
});
test('mcp list does not flag a disabled needs-review server', async () => {
  const state = fixture(async () =>
    response({
      upstreams: [
        {
          id: 'mu_3',
          name: 'paused',
          state: 'needs-review',
          transport: 'http',
          toolCount: 1,
          risk: 'LOW',
          enabled: false,
        },
      ],
    }),
  );
  await runMcpCommand({}, { command: 'mcp', action: 'list' }, state.dependencies);
  assert.equal(state.logs.length, 5);
  assert.ok(state.logs[3]!.startsWith('│   │'));
});
test('mcp enable and disable post to their endpoints and log the result', async () => {
  const state = fixture(async () => response({ id: 'mu_1', enabled: true }));
  assert.equal(
    await runMcpCommand({}, { command: 'mcp', action: 'enable', id: 'mu_1' }, state.dependencies),
    0,
  );
  assert.equal(state.calls[0].path, '/api/mcp/upstreams/mu_1/enable');
  assert.equal(state.calls[0].init.method, 'POST');
  assert.equal(state.logs[0], '[aevra] Enabled mu_1');
  assert.equal(
    await runMcpCommand({}, { command: 'mcp', action: 'disable', id: 'mu_1' }, state.dependencies),
    0,
  );
  assert.equal(state.calls[1].path, '/api/mcp/upstreams/mu_1/disable');
  assert.equal(state.calls[1].init.method, 'POST');
  assert.equal(state.logs[1], '[aevra] Disabled mu_1');
});
test('a failed mcp enable or disable returns nonzero with the formatted error', async () => {
  const state = fixture(async () => response({ error: { message: 'not found' } }, false, 404));
  assert.equal(
    await runMcpCommand({}, { command: 'mcp', action: 'enable', id: 'gone' }, state.dependencies),
    1,
  );
  assert.equal(
    await runMcpCommand({}, { command: 'mcp', action: 'disable', id: 'gone' }, state.dependencies),
    1,
  );
  assert.deepEqual(state.errors, [
    '[aevra] mcp failed: not found',
    '[aevra] mcp failed: not found',
  ]);
  assert.deepEqual(state.logs, []);
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
      secretRef: plainPhrase1,
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
    auth: { header: 'Authorization', secretRefId: plainPhrase1 },
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
