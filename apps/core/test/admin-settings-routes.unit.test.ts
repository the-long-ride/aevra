import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import { handleSettingsRoutes } from '../src/admin/routes/settings-routes.js';

function request(method: string, value?: unknown, headers: Record<string, string> = {}) {
  const text = value === undefined ? '' : JSON.stringify(value);
  const stream = Readable.from(text ? [Buffer.from(text)] : []) as any;
  stream.method = method;
  stream.headers = headers;
  return stream;
}

function response() {
  const result = {
    statusCode: 0,
    body: '',
    setHeader() {},
    end(value = '') {
      result.body = String(value);
    },
  };
  return result as any;
}

function fixture() {
  const values = new Map<string, any>();
  const revisions = new Map<string, number>();
  const permissions: any[] = [];
  const deleted: string[] = [];
  const settings = {
    get(key: string, fallback: unknown) {
      return values.has(key) ? values.get(key) : fallback;
    },
    set(key: string, value: unknown) {
      values.set(key, value);
      revisions.set(key, (revisions.get(key) ?? 0) + 1);
    },
    revision(key: string) {
      return revisions.get(key) ?? 0;
    },
  };
  return {
    context: {
      settings,
      permissions: {
        upsert: (rule: any) => permissions.push(rule),
        delete: (id: string) => deleted.push(id),
      },
    } as any,
    values,
    revisions,
    permissions,
    deleted,
  };
}

async function call(
  fx: ReturnType<typeof fixture>,
  pathname: string,
  method: string,
  value?: unknown,
  headers?: Record<string, string>,
) {
  const res = response();
  const handled = await handleSettingsRoutes(
    request(method, value, headers),
    res,
    new URL(`https://localhost${pathname}`),
    fx.context,
  );
  return { handled, status: res.statusCode, value: res.body ? JSON.parse(res.body) : undefined };
}

test('command family and execution settings routes persist revisions and defaults', async () => {
  const fx = fixture();
  assert.deepEqual((await call(fx, '/api/policy/command-families', 'GET')).value, {});
  const patched = await call(fx, '/api/policy/command-families', 'PATCH', { git: 'READ_ONLY' });
  assert.equal(patched.status, 200);
  assert.equal(patched.value.revision, 1);
  assert.deepEqual(fx.values.get('command.family.overrides'), { git: 'READ_ONLY' });

  const defaults = await call(fx, '/api/execution-settings', 'GET');
  assert.equal(defaults.value.sandboxBackend, 'auto');
  assert.equal(defaults.value.searchMaxQueries, 8);
  const updated = await call(fx, '/api/execution-settings', 'PATCH', {
    sandboxBackend: 'native',
    workspaceDrainMs: 1200,
    searchMaxQueries: 100,
  });
  assert.equal(updated.value.value.searchMaxQueries, 32);
  assert.equal(fx.values.get('workspace.drain.defaultMs'), 1200);
  const clamped = await call(fx, '/api/execution-settings', 'PATCH', { searchMaxQueries: 0 });
  assert.equal(clamped.value.value.searchMaxQueries, 8);
});

test('network rule routes reject wildcards and maintain matching permission rules', async () => {
  const fx = fixture();
  assert.deepEqual((await call(fx, '/api/policy/network-rules', 'GET')).value, []);
  for (const host of ['', '*.example.com']) {
    const denied = await call(fx, '/api/policy/network-rules', 'POST', { host });
    assert.equal(denied.status, 400);
    assert.equal(denied.value.error.code, 'INVALID_NETWORK_RULE');
  }
  const created = await call(fx, '/api/policy/network-rules', 'POST', {
    id: 'rule-1',
    effect: 'deny',
    protocol: 'HTTP:',
    host: 'EXAMPLE.COM',
    port: 8080,
    workspaceId: 'ws-1',
  });
  assert.equal(created.status, 200);
  assert.deepEqual(created.value.rule, {
    id: 'rule-1',
    effect: 'deny',
    protocol: 'http',
    host: 'example.com',
    port: 8080,
    workspaceId: 'ws-1',
  });
  assert.equal(fx.permissions[0].scope, 'workspace');
  assert.equal(fx.permissions[0].matcher, 'network.host:http:example.com:8080');

  const global = await call(fx, '/api/policy/network-rules', 'POST', { host: 'api.example.com' });
  assert.equal(global.value.rule.effect, 'allow');
  assert.equal(global.value.rule.protocol, 'https');
  assert.equal(global.value.rule.port, 443);
  assert.equal(fx.permissions[1].scope, 'global');

  const removed = await call(fx, '/api/policy/network-rules/rule-1', 'DELETE');
  assert.equal(removed.status, 200);
  assert.deepEqual(fx.deleted, ['perm_rule-1']);
  assert.equal(
    fx.values.get('network.rules').some((row: any) => row.id === 'rule-1'),
    false,
  );
});

test('hook routes normalize full hook configuration and reject invalid variants', async () => {
  const fx = fixture();
  assert.deepEqual((await call(fx, '/api/hooks', 'GET')).value, []);
  const created = await call(fx, '/api/hooks', 'POST', {
    id: 'h1',
    name: '',
    kind: 'command',
    event: 'before_response',
    enabled: false,
    execution: 'launch',
    executable: 'node',
    args: ['hook.js', 1],
    env: { PORT: 3 },
    permissions: ['modifyResponse', 'modifyResponse'],
    timeoutMs: 90_000,
    failurePolicy: 'continue',
  });
  assert.equal(created.status, 201);
  assert.equal(created.value.hook.enabled, false);
  assert.equal(created.value.hook.execution, 'launch');
  assert.deepEqual(created.value.hook.permissions, ['observe', 'modifyResponse']);
  assert.deepEqual(created.value.hook.args, ['hook.js', '1']);
  assert.deepEqual(created.value.hook.env, { PORT: '3' });
  assert.equal(created.value.hook.timeoutMs, 60_000);

  const defaults = await call(fx, '/api/hooks', 'POST', {
    executable: 'node',
    env: [],
    timeoutMs: 1,
  });
  assert.equal(defaults.status, 201);
  assert.equal(defaults.value.hook.event, 'before_tool_call');
  assert.equal(defaults.value.hook.execution, 'run');
  assert.deepEqual(defaults.value.hook.permissions, ['observe']);
  assert.deepEqual(defaults.value.hook.env, {});
  assert.equal(defaults.value.hook.timeoutMs, 100);

  const invalids = [
    { event: 'invalid', executable: 'node' },
    { event: 'before_tool_call', executable: '' },
    { executable: 'node', permissions: ['danger'] },
    { executable: 'node', permissions: ['observe'], failurePolicy: 'block' },
  ];
  for (const input of invalids) {
    const result = await call(fx, '/api/hooks', 'POST', input);
    assert.equal(result.status, 400);
    assert.equal(result.value.error.code, 'INVALID_HOOK');
  }
});

test('hook update delete missing and blocking branches are handled', async () => {
  const fx = fixture();
  fx.values.set('hooks.config', [
    {
      id: 'h1',
      name: 'One',
      event: 'before_tool_call',
      enabled: true,
      kind: 'command',
      execution: 'run',
      executable: 'node',
      args: [],
      env: {},
      permissions: ['observe'],
      timeoutMs: 5000,
      failurePolicy: 'continue',
    },
  ]);
  assert.equal((await call(fx, '/api/hooks/missing', 'PATCH', {})).status, 404);
  const bad = await call(fx, '/api/hooks/h1', 'PATCH', { event: 'bad' });
  assert.equal(bad.status, 400);
  const updated = await call(fx, '/api/hooks/h1', 'PATCH', {
    failurePolicy: 'block',
    permissions: ['block'],
  });
  assert.equal(updated.status, 200);
  assert.deepEqual(updated.value.hook.permissions, ['observe', 'block']);
  assert.equal(updated.value.hook.failurePolicy, 'block');
  const removed = await call(fx, '/api/hooks/h1', 'DELETE');
  assert.equal(removed.status, 200);
  assert.equal(fx.values.get('hooks.config').length, 0);
});

test('settings onboarding guide and unmatched routes cover revision behavior', async () => {
  const fx = fixture();
  assert.deepEqual((await call(fx, '/api/settings', 'GET')).value, {});
  fx.revisions.set('admin.settings', 2);
  const stale = await call(fx, '/api/settings', 'PATCH', { revision: 1, value: { theme: 'dark' } });
  assert.equal(stale.status, 409);
  assert.equal(stale.value.error.current, 2);
  const saved = await call(
    fx,
    '/api/settings',
    'PATCH',
    { value: { theme: 'dark' } },
    { 'if-match': '2' },
  );
  assert.equal(saved.status, 200);
  assert.deepEqual(fx.values.get('admin.settings'), { theme: 'dark' });
  const raw = await call(fx, '/api/settings', 'PATCH', { compact: true });
  assert.equal(raw.status, 200);
  assert.equal(fx.values.get('admin.settings').compact, true);

  const onboarding = await call(fx, '/api/onboarding', 'GET');
  assert.equal(onboarding.value.completed, false);
  const completed = await call(fx, '/api/onboarding', 'PATCH', {
    completed: true,
    completedSections: ['remote-access', 'remote-access'],
  });
  assert.equal(completed.value.state.completed, true);
  assert.deepEqual(completed.value.state.completedSections, ['remote-access']);
  const guide = await call(fx, '/api/guide', 'GET');
  assert.ok(Array.isArray(guide.value));
  const unmatched = await call(fx, '/api/not-settings', 'GET');
  assert.equal(unmatched.handled, false);
});
