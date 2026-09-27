import assert from 'node:assert/strict';
import test from 'node:test';
import { runConnectorsCommand } from '../src/commands/connectors-command.js';
import { runMaintenanceCommand } from '../src/commands/maintenance-command.js';
import { runMcpCommand } from '../src/commands/mcp-command.js';

type Reply = { ok: boolean; status: number; json(): Promise<unknown> };

function reply(body: unknown = {}, ok = true, status = 200): Reply {
  return { ok, status, json: async () => body };
}

const brokenJson: Reply = {
  ok: false,
  status: 502,
  json: async () => {
    throw new Error('not json');
  },
};

function harness(handler: (path: string, init?: any) => Promise<Reply> | Reply) {
  const logs: string[] = [];
  const errors: string[] = [];
  const calls: Array<{ path: string; init?: any }> = [];
  return {
    logs,
    errors,
    calls,
    deps: {
      api: async (_config: object, path: string, init?: any) => {
        calls.push({ path, init });
        return handler(path, init);
      },
      log: (message: string) => logs.push(message),
      error: (message: string) => errors.push(message),
      formatError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
    },
  };
}

const mcp = (fields: Record<string, unknown>) => ({ command: 'mcp', ...fields }) as any;

test('mcp add builds stdio bodies with and without env and http bodies without auth', async () => {
  const h = harness(() => reply({ id: 'u1', name: 'local', toolCount: 2 }));
  await runMcpCommand(
    {},
    mcp({
      action: 'add',
      name: 'local',
      transport: 'stdio',
      executable: 'node',
      env: { SAMPLE: 'words' },
    }),
    h.deps,
  );
  await runMcpCommand(
    {},
    mcp({ action: 'add', name: 'bare', transport: 'stdio', executable: 'node', args: ['x'] }),
    h.deps,
  );
  await runMcpCommand(
    {},
    mcp({
      action: 'add',
      name: 'web',
      transport: 'http',
      url: 'https://mcp.example.test/mcp',
      secretRef: 'ref-1',
    }),
    h.deps,
  );
  await runMcpCommand(
    {},
    mcp({ action: 'add', name: 'open', transport: 'http', url: 'https://open.example.test/mcp' }),
    h.deps,
  );
  const bodies = h.calls.map((call) => JSON.parse(call.init.body));
  assert.deepEqual(bodies[0], {
    name: 'local',
    transport: 'stdio',
    config: { command: 'node', args: [] },
    auth: { env: { SAMPLE: 'words' } },
    risk: 'MEDIUM',
  });
  assert.deepEqual(bodies[1].config, { command: 'node', args: ['x'] });
  assert.equal('auth' in bodies[1], false);
  assert.deepEqual(bodies[2].auth, { header: 'Authorization', secretRefId: 'ref-1' });
  assert.equal('auth' in bodies[3], false);
  assert.deepEqual(h.logs.slice(0, 2), [
    '[aevra] Registered local (u1)',
    '[aevra] 2 tools published as local__<tool>',
  ]);
});

test('mcp failures use the error message, the status, or a connectivity hint', async () => {
  let h = harness(() => reply({ error: { message: 'duplicate name' } }, false, 409));
  assert.equal(
    await runMcpCommand({}, mcp({ action: 'add', name: 'x', transport: 'http', url: 'u' }), h.deps),
    1,
  );
  assert.equal(h.errors[0], '[aevra] mcp failed: duplicate name');

  h = harness(() => reply({}, false, 404));
  await runMcpCommand({}, mcp({ action: 'list' }), h.deps);
  assert.equal(h.errors[0], '[aevra] mcp failed: 404');

  h = harness(() => brokenJson);
  await runMcpCommand({}, mcp({ action: 'remove', id: 'u1' }), h.deps);
  assert.equal(h.errors[0], '[aevra] mcp failed: 502');

  h = harness(() => brokenJson);
  await runMcpCommand({}, mcp({ action: 'test', id: 'u1' }), h.deps);
  assert.equal(h.errors[0], '[aevra] mcp failed: 502');

  h = harness(() => {
    throw Object.assign(new Error('connect refused'), { code: 'ECONNREFUSED' });
  });
  await runMcpCommand({}, mcp({ action: 'list' }), h.deps);
  assert.equal(h.errors[0], '[aevra] mcp failed: connect refused. Is aevra start/service running?');

  h = harness(() => {
    throw 'odd failure';
  });
  await runMcpCommand({}, mcp({ action: 'list' }), h.deps);
  assert.equal(h.errors[0], '[aevra] mcp failed: odd failure');
});

test('mcp list tolerates a missing upstream array and test reports defaults', async () => {
  let h = harness(() => reply({}));
  assert.equal(await runMcpCommand({}, mcp({ action: 'list' }), h.deps), 0);
  assert.deepEqual(h.logs, ['No MCP servers registered.']);

  h = harness(() => reply({ ok: false }));
  assert.equal(await runMcpCommand({}, mcp({ action: 'test', id: 'a b' }), h.deps), 1);
  assert.equal(h.calls[0]!.path, '/api/mcp/upstreams/a%20b/test');
  assert.equal(h.errors[0], '[aevra] mcp test failed: the connection failed');

  h = harness(() => reply({ ok: true }));
  assert.equal(await runMcpCommand({}, mcp({ action: 'test', id: 'u1' }), h.deps), 0);
  assert.deepEqual(h.logs, ['[aevra] Connected to unknown', '[aevra] 0 tools available']);
});

const maint = (fields: Record<string, unknown>) => fields as any;

test('sessions list formats client, actor and default labels', async () => {
  let h = harness(() =>
    reply([
      { id: 's1', client: 'Claude', actor: 'ignored', lastActivityAt: 'today' },
      { id: 's2', actor: 'admin' },
      { id: 's3' },
    ]),
  );
  assert.equal(
    await runMaintenanceCommand({}, maint({ command: 'sessions', action: 'list' }), h.deps),
    0,
  );
  assert.deepEqual(h.logs, ['s1  Claude  last active today', 's2  admin', 's3  session']);

  h = harness(() => reply([]));
  await runMaintenanceCommand({}, maint({ command: 'sessions', action: 'list' }), h.deps);
  assert.deepEqual(h.logs, ['No active sessions.']);
});

test('sessions revoke and maintenance failures name the failed action', async () => {
  let h = harness(() => reply());
  assert.equal(
    await runMaintenanceCommand(
      {},
      maint({ command: 'sessions', action: 'revoke', id: 'a/b' }),
      h.deps,
    ),
    0,
  );
  assert.equal(h.calls[0]!.path, '/api/sessions/a%2Fb/revoke');
  assert.deepEqual(h.logs, ['[aevra] Revoked session a/b']);

  const cases: Array<[Record<string, unknown>, string]> = [
    [{ command: 'sessions', action: 'list' }, 'sessions list'],
    [{ command: 'sessions', action: 'revoke', id: 'x' }, 'sessions revoke'],
    [{ command: 'sessions', action: 'revoke-others', yes: true }, 'sessions revoke-others'],
    [{ command: 'audit', action: 'clear', yes: true }, 'audit clear'],
  ];
  for (const [command, label] of cases) {
    h = harness(() => reply({}, false, 500));
    assert.equal(await runMaintenanceCommand({}, maint(command), h.deps), 1);
    assert.equal(
      h.errors[0],
      `[aevra] ${label} failed: Core returned 500. Is aevra start/service running?`,
    );
  }

  h = harness(() => reply());
  assert.equal(
    await runMaintenanceCommand(
      {},
      maint({ command: 'sessions', action: 'revoke-others', yes: false }),
      h.deps,
    ),
    1,
  );
  assert.match(h.errors[0]!, /revoke-others removes/);
});

test('maintenance success paths default missing counters to zero', async () => {
  let h = harness(() => reply({}));
  await runMaintenanceCommand({}, maint({ command: 'audit', action: 'clear', yes: true }), h.deps);
  assert.deepEqual(h.logs, ['[aevra] Cleared 0 audit event(s).']);
  h = harness(() => reply({}));
  await runMaintenanceCommand(
    {},
    maint({ command: 'sessions', action: 'revoke-others', yes: true }),
    h.deps,
  );
  assert.match(
    h.logs[0]!,
    /Revoked 0 remote and 0 admin session\(s\); preserved 0 connector and 0 current/,
  );
});

const conn = (fields: Record<string, unknown>) => ({ command: 'connectors', ...fields }) as any;

test('connectors list, create and revoke cover endpoint discovery outcomes', async () => {
  let h = harness(() =>
    reply([
      { id: 'c1', name: 'one', createdAt: 'd1', lastUsedAt: 'd2' },
      { id: 'c2', name: 'two', createdAt: 'd3', lastUsedAt: null },
    ]),
  );
  await runConnectorsCommand({}, conn({ action: 'list' }), h.deps);
  assert.deepEqual(h.logs, ['c1  one  created d1  last used d2', 'c2  two  created d3']);

  const created = { id: 'c9', name: 'new', token: 'sample-words' };
  const endpoints: Array<[() => Reply, string]> = [
    [
      () => reply({ publicUrl: 'https://edge.example.test//' }),
      '[aevra] URL: https://edge.example.test/mcp',
    ],
    [
      () => reply({ publicUrl: 5 }),
      '[aevra] URL: configure Remote Access to get a reachable endpoint (aevra setup)',
    ],
    [
      () => reply({}, false, 503),
      '[aevra] URL: configure Remote Access to get a reachable endpoint (aevra setup)',
    ],
    [
      () => {
        throw new Error('offline');
      },
      '[aevra] URL: configure Remote Access to get a reachable endpoint (aevra setup)',
    ],
  ];
  for (const [exposure, expected] of endpoints) {
    h = harness((path) => (path === '/api/exposure/status' ? exposure() : reply(created)));
    assert.equal(
      await runConnectorsCommand({}, conn({ action: 'create', name: 'new' }), h.deps),
      0,
    );
    assert.equal(h.logs[1], expected);
  }

  h = harness(() => reply({ error: { message: 'name taken' } }, false, 409));
  assert.equal(await runConnectorsCommand({}, conn({ action: 'create', name: 'x' }), h.deps), 1);
  assert.match(h.errors[0]!, /connectors failed: name taken/);
  h = harness(() => reply({}, false, 409));
  await runConnectorsCommand({}, conn({ action: 'create', name: 'x' }), h.deps);
  assert.match(h.errors[0]!, /connectors failed: 409/);
  h = harness(() => reply({}, false, 500));
  await runConnectorsCommand({}, conn({ action: 'list' }), h.deps);
  assert.match(h.errors[0]!, /Core returned 500/);
  h = harness(() => reply({}, false, 404));
  assert.equal(await runConnectorsCommand({}, conn({ action: 'revoke', id: 'c1' }), h.deps), 1);
  assert.match(h.errors[0]!, /Core returned 404/);
});
