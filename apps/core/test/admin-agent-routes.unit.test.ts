import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import { handleAgentRoutes } from '../src/admin/routes/agent-routes.js';

function request(method: string, value?: unknown) {
  const text = value === undefined ? '' : JSON.stringify(value);
  const stream = Readable.from(text ? [Buffer.from(text)] : []) as any;
  stream.method = method;
  stream.headers = {};
  return stream;
}
function response() {
  const finish: Array<() => void> = [];
  const result = {
    statusCode: 0,
    body: '',
    finish,
    setHeader() {},
    once(event: string, callback: () => void) {
      if (event === 'finish') finish.push(callback);
    },
    end(v = '') {
      result.body = String(v);
    },
  };
  return result as any;
}
async function call(pathname: string, method: string, context: any = {}, value?: unknown) {
  const res = response();
  const handled = await handleAgentRoutes(
    request(method, value),
    res,
    new URL(`https://localhost${pathname}`),
    context,
  );
  return {
    handled,
    status: res.statusCode,
    value: res.body ? JSON.parse(res.body) : undefined,
    res,
  };
}

const WORKSPACE_ROOT = 'C:\\projects\\garden';

function fixture(agents?: (input: any) => Promise<unknown>) {
  const calls: any[] = [];
  const inputs: any[] = [];
  const workspaceRows: any[] = [
    { id: 'w1', name: 'Garden', hostRoot: WORKSPACE_ROOT },
    { id: 'w2', name: 'Remote only' },
  ];
  const okResult = (input: any) => ({
    dryRun: false,
    message: 'done',
    registrations: [],
    notes: ['restart'],
    changes: [],
    results: (input.targets ?? [input.target]).map((target: string) => ({
      target,
      ok: true,
      message: 'done',
    })),
  });
  const context: any = {
    agents:
      agents ??
      (async (input: any) => {
        inputs.push(input);
        return okResult(input);
      }),
    workspaces: {
      getLocal: (id: string) => workspaceRows.find((row) => row.id === id) ?? null,
      listLocal: () => workspaceRows,
    },
    connectors: {
      list: () => [
        { id: 'cred-one', name: 'aevra:codex', lastUsedAt: '2026-10-17T01:02:03.000Z' },
        { id: 'cred-two', name: 'aevra:opencode', lastUsedAt: null },
      ],
    },
    audit: { append: (row: any) => calls.push(row) },
  };
  return { context, calls, inputs };
}

test('detect route returns the detection list and rejects other methods', async () => {
  const list = [{ target: 'codex', found: true, evidence: 'path', configPath: 'x', scopes: [] }];
  const seen: any[] = [];
  const context: any = {
    agents: async (input: unknown) => {
      seen.push(input);
      return list;
    },
  };
  const detected = await call('/api/agents/detect', 'GET', context);
  assert.equal(detected.status, 200);
  assert.deepEqual(detected.value, list);
  assert.deepEqual(seen, [{ operation: 'detect' }]);
  assert.equal((await call('/api/agents/detect', 'POST', context, {})).status, 405);
  assert.equal((await call('/api/agents/detect', 'GET', {})).status, 503);
});

test('POST with two targets reports one ok and one error and audits each target', async () => {
  const fx = fixture(async () => ({
    dryRun: false,
    message: 'partial',
    registrations: [],
    notes: [],
    changes: [],
    results: [
      { target: 'codex', ok: true, message: 'done' },
      { target: 'opencode', ok: false, error: 'AGENT_CONFIG_CONFLICT: not managed' },
    ],
  }));
  const out = await call('/api/agents', 'POST', fx.context, {
    operation: 'install',
    targets: ['codex', 'opencode'],
    transport: 'stdio',
  });
  assert.equal(out.status, 200);
  assert.deepEqual(
    out.value.results.map((row: any) => [row.target, row.ok]),
    [
      ['codex', true],
      ['opencode', false],
    ],
  );
  assert.match(out.value.results[1].error, /CONFLICT/);
  for (const key of ['registrations', 'notes', 'changes']) assert.ok(Array.isArray(out.value[key]));
  assert.equal(fx.calls.length, 2);
  assert.deepEqual(
    fx.calls.map((row) => [row.operation, row.target, row.result, row.scope]),
    [
      ['agent.install', 'codex', 'ok', 'user'],
      ['agent.install', 'opencode', 'error', 'user'],
    ],
  );
  for (const row of fx.calls) {
    assert.equal('workspaceId' in row, false);
    assert.equal(row.actor, 'admin');
    assert.equal(row.redactionCount, 0);
    assert.equal('dryRun' in row, false);
    assert.equal(JSON.stringify(row).includes('CONFLICT'), false);
  }
});

test('workspace scope resolves workspaceId to hostRoot and never trusts a client path', async () => {
  const fx = fixture();
  const out = await call('/api/agents', 'POST', fx.context, {
    operation: 'install',
    targets: ['codex'],
    scope: 'workspace',
    workspaceId: 'w1',
    workspaceRoot: 'D:\\somewhere\\else',
    transport: 'stdio',
  });
  assert.equal(out.status, 200);
  assert.equal(fx.inputs.length, 1);
  assert.equal(fx.inputs[0].scope, 'workspace');
  assert.equal(fx.inputs[0].workspaceRoot, WORKSPACE_ROOT);
  assert.equal(fx.calls[0].workspaceId, 'w1');
  assert.equal(fx.calls[0].scope, 'workspace');
  const user = await call('/api/agents', 'POST', fx.context, {
    operation: 'install',
    targets: ['codex'],
    workspaceRoot: 'D:\\somewhere\\else',
    workspaceId: 'w1',
  });
  assert.equal(user.status, 200);
  // No scope sent: none is forwarded and core applies its default (user).
  assert.equal(fx.inputs[1].scope, undefined);
  assert.equal(fx.calls[1].scope, 'user');
  assert.equal(fx.inputs[1].workspaceRoot, undefined);
});

test('unknown workspace and workspace without hostRoot are refused before the function runs', async () => {
  const fx = fixture();
  const base = { operation: 'install', targets: ['codex'], scope: 'workspace' };
  for (const workspaceId of ['missing', 'w2', undefined, 7]) {
    const out = await call('/api/agents', 'POST', fx.context, { ...base, workspaceId });
    assert.equal(out.status, 400);
    assert.equal(out.value.error.code, 'AGENT_WORKSPACE_UNAVAILABLE');
  }
  assert.equal(fx.inputs.length, 0);
  assert.equal(fx.calls.length, 0);
});

test('workspace scope with http transport is a 400', async () => {
  const fx = fixture();
  const out = await call('/api/agents', 'POST', fx.context, {
    operation: 'install',
    targets: ['codex'],
    scope: 'workspace',
    workspaceId: 'w1',
    transport: 'http',
  });
  assert.equal(out.status, 400);
  assert.equal(out.value.error.code, 'AGENT_OPTIONS_INVALID');
  assert.equal(fx.inputs.length, 0);
  assert.equal(fx.calls.length, 0);
});

test('validation errors from the function map to 400 and other failures are rethrown', async () => {
  const invalid = fixture(async () => {
    throw new Error('AGENT_OPTIONS_INVALID: targets must name known agents');
  });
  const out = await call('/api/agents', 'POST', invalid.context, {
    operation: 'install',
    targets: ['nope'],
  });
  assert.equal(out.status, 400);
  assert.equal(out.value.error.code, 'AGENT_OPTIONS_INVALID');
  assert.equal(invalid.calls.length, 0);

  const broken = fixture(async () => {
    throw new Error('AGENT_INSTALL_BUSY: lock');
  });
  await assert.rejects(
    call('/api/agents', 'POST', broken.context, { operation: 'install', target: 'codex' }),
    /AGENT_INSTALL_BUSY/,
  );
  assert.deepEqual(
    broken.calls.map((row) => [row.operation, row.target, row.result]),
    [['agent.install', 'codex', 'error']],
  );

  assert.equal(
    (await call('/api/agents', 'POST', fixture().context, { operation: 'detect' })).status,
    400,
  );
});

test('a single target is still forwarded and a dry run is audited once as a dry run', async () => {
  const fx = fixture();
  const out = await call('/api/agents', 'POST', fx.context, {
    operation: 'uninstall',
    target: 'claude-code',
    transport: 'stdio',
    dryRun: true,
  });
  assert.equal(out.status, 200);
  assert.equal(fx.inputs[0].target, 'claude-code');
  assert.equal(fx.inputs[0].targets, undefined);
  assert.equal(fx.inputs[0].dryRun, true);
  assert.deepEqual(
    fx.calls.map((row) => [row.operation, row.target, row.result, row.dryRun]),
    [['agent.uninstall', 'claude-code', 'ok', true]],
  );
});

test('GET joins lastUsedAt by credentialId and gives null without a connector', async () => {
  const registrations = [
    { target: 'codex', scope: 'user', credentialId: 'cred-one', state: 'installed' },
    { target: 'opencode', scope: 'user', credentialId: 'cred-two', state: 'installed' },
    { target: 'antigravity', scope: 'user', credentialId: 'cred-gone', state: 'incomplete' },
    {
      target: 'claude-code',
      scope: 'workspace',
      workspaceRoot: 'c:/Projects/Garden/',
      credentialId: 'cred-one',
    },
  ];
  const seen: any[] = [];
  const fx = fixture();
  fx.context.agents = async (input: unknown) => {
    seen.push(input);
    return { dryRun: false, message: 'status', registrations, notes: [], changes: [] };
  };
  const out = await call('/api/agents', 'GET', fx.context);
  assert.equal(out.status, 200);
  assert.deepEqual(seen, [{ operation: 'status', target: 'all', transport: 'stdio' }]);
  const rows = out.value.registrations;
  assert.deepEqual(
    rows.map((row: any) => row.lastUsedAt),
    ['2026-10-17T01:02:03.000Z', null, null, '2026-10-17T01:02:03.000Z'],
  );
  // Case and slash differences match only where the file system ignores case.
  const loose = process.platform === 'win32' || process.platform === 'darwin';
  assert.equal(rows[3].workspaceId, loose ? 'w1' : undefined);
  assert.equal('workspaceId' in rows[0], false);
  assert.equal(rows[0].state, 'installed');
  const bare = fixture();
  bare.context.agents = fx.context.agents;
  delete bare.context.connectors;
  delete bare.context.workspaces;
  const noConnectors = await call('/api/agents', 'GET', bare.context);
  assert.equal(noConnectors.value.registrations[0].lastUsedAt, null);
});

test('shutdown route and the unavailable response are unchanged', async () => {
  let stopped = 0;
  const context: any = { stopCore: () => stopped++ };
  const out = await call('/api/agents/shutdown', 'POST', context);
  assert.equal(out.status, 200);
  assert.deepEqual(out.value, { ok: true });
  assert.equal(stopped, 0);
  out.res.finish[0]();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(stopped, 1);

  const unavailable = await call('/api/agents', 'GET', {});
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.value.error.code, 'AGENT_INTEGRATION_UNAVAILABLE');
  assert.equal((await call('/api/agents', 'PUT', { agents: async () => ({}) })).status, 405);
  assert.equal((await call('/api/other', 'GET', {})).handled, false);
});
