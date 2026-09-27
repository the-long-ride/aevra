import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import { handleSettingsRoutes } from '../src/admin/routes/settings-routes.js';

function request(method: string | undefined, body?: unknown, raw?: string) {
  const text = raw ?? (body === undefined ? '' : JSON.stringify(body));
  const stream = Readable.from(text ? [Buffer.from(text)] : []) as any;
  stream.method = method;
  stream.headers = {};
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

async function call(context: any, path: string, method?: string, body?: unknown, raw?: string) {
  const res = response();
  const handled = await handleSettingsRoutes(
    request(method, body, raw),
    res,
    new URL(`https://localhost${path}`),
    context,
  );
  return { handled, status: res.statusCode, value: res.body ? JSON.parse(res.body) : undefined };
}

// A settings store without a revision() method, exercising the `?? 1` fallbacks.
function plainSettings() {
  const values = new Map<string, any>();
  return {
    values,
    settings: {
      get: (key: string, fallback: unknown) => (values.has(key) ? values.get(key) : fallback),
      set: (key: string, value: unknown) => void values.set(key, value),
    },
  };
}

test('routes without a settings store answer with empty defaults', async () => {
  const context = {};
  assert.deepEqual((await call(context, '/api/policy/command-families')).value, {});
  assert.deepEqual((await call(context, '/api/policy/network-rules')).value, []);
  assert.deepEqual((await call(context, '/api/execution-settings')).value, {});
  assert.deepEqual((await call(context, '/api/hooks')).value, []);
  assert.deepEqual((await call(context, '/api/settings')).value, {});
  const onboarding = await call(context, '/api/onboarding');
  assert.equal(onboarding.status, 200);
  assert.equal(onboarding.value.completed, false);
});

test('mutations without a settings store still acknowledge with revision 1', async () => {
  const context = {};
  const families = await call(context, '/api/policy/command-families', 'PATCH', { git: 'x' });
  assert.deepEqual(families.value, { ok: true, revision: 1 });
  const rule = await call(context, '/api/policy/network-rules', 'POST', { host: 'example.org' });
  assert.equal(rule.value.revision, 1);
  assert.equal(rule.value.rule.workspaceId, null);
  assert.ok(rule.value.rule.id.startsWith('net_'));
  const hostless = await call(context, '/api/policy/network-rules', 'POST', { port: 80 });
  assert.deepEqual([hostless.status, hostless.value.error.code], [400, 'INVALID_NETWORK_RULE']);
  const removed = await call(context, '/api/policy/network-rules/net_1', 'DELETE');
  assert.deepEqual(removed.value, { ok: true, revision: 1 });
  const exec = await call(context, '/api/execution-settings', 'PATCH', { cachePolicy: 'none' });
  assert.deepEqual(exec.value.value, { cachePolicy: 'none', searchMaxQueries: 8 });
  assert.equal(exec.value.revision, 1);
  const hook = await call(context, '/api/hooks', 'POST', { executable: 'node' });
  assert.equal(hook.status, 201);
  const missing = await call(context, '/api/hooks/any', 'PATCH', {});
  assert.equal(missing.status, 404);
  assert.equal((await call(context, '/api/hooks/any', 'DELETE')).status, 200);
  const onboarding = await call(context, '/api/onboarding', 'PATCH', { completed: true });
  assert.equal(onboarding.value.state.completed, true);
});

test('settings store without revision tracking falls back to revision 1', async () => {
  const fx = plainSettings();
  const families = await call(fx, '/api/policy/command-families', 'PATCH', { npm: 'SAFE' });
  assert.equal(families.value.revision, 1);
  const rule = await call(fx, '/api/policy/network-rules', 'POST', { host: 'a.example' });
  assert.equal(rule.value.revision, 1);
  assert.equal(fx.values.get('network.rules').length, 1);
  assert.equal((await call(fx, '/api/policy/network-rules/x', 'DELETE')).value.revision, 1);
  const exec = await call(fx, '/api/execution-settings', 'PATCH', { searchMaxQueries: 4 });
  assert.deepEqual([exec.value.revision, exec.value.value.searchMaxQueries], [1, 4]);
  assert.equal(fx.values.has('workspace.drain.defaultMs'), false);
});

test('hook normalization fills name, kind and timeout defaults', async () => {
  const fx = plainSettings();
  const created = await call(fx, '/api/hooks', 'POST', {
    executable: ' node ',
    name: '',
    kind: '',
  });
  assert.equal(created.status, 201);
  const hook = created.value.hook;
  assert.equal(hook.name, 'Hook');
  assert.equal(hook.kind, 'command');
  assert.equal(hook.timeoutMs, 5000);
  assert.equal(hook.executable, 'node');
  assert.equal(hook.enabled, true);
  assert.equal(hook.failurePolicy, 'continue');
  assert.ok(hook.id.startsWith('hook_'));
  const named = await call(fx, '/api/hooks', 'POST', { executable: 'node', kind: 'script' });
  assert.equal(named.value.hook.name, 'script');
  assert.equal(fx.values.get('hooks.config').length, 2);
});

test('a null hook body is rejected as missing executable', async () => {
  const result = await call({}, '/api/hooks', 'POST', undefined, 'null');
  assert.equal(result.status, 400);
  assert.deepEqual(result.value.error, {
    code: 'INVALID_HOOK',
    message: 'Hook executable is required',
  });
});

test('non-Error failures while saving hooks are stringified', async () => {
  const settings = {
    get: (_key: string, fallback: unknown) =>
      _key === 'hooks.config' ? [{ id: 'h1', executable: 'node' }] : fallback,
    set: () => {
      throw 'disk unavailable';
    },
  };
  const created = await call({ settings }, '/api/hooks', 'POST', { executable: 'node' });
  assert.deepEqual([created.status, created.value.error.message], [400, 'disk unavailable']);
  const patched = await call({ settings }, '/api/hooks/h1', 'PATCH', { name: 'renamed' });
  assert.deepEqual([patched.status, patched.value.error.message], [400, 'disk unavailable']);
});

test('hook PATCH keeps the path id and decodes it', async () => {
  const fx = plainSettings();
  fx.values.set('hooks.config', [
    { id: 'a b', executable: 'node', event: 'after_response' },
    { id: 'other', executable: 'python' },
  ]);
  const patched = await call(fx, '/api/hooks/a%20b', 'PATCH', { id: 'spoofed', timeoutMs: 250 });
  assert.equal(patched.status, 200);
  assert.equal(patched.value.hook.id, 'a b');
  assert.equal(patched.value.hook.timeoutMs, 250);
  assert.equal(patched.value.hook.event, 'after_response');
  assert.deepEqual(
    fx.values.get('hooks.config').map((hook: any) => hook.id),
    ['a b', 'other'],
  );
  await call(fx, '/api/hooks/a%20b', 'DELETE');
  assert.deepEqual(
    fx.values.get('hooks.config').map((hook: any) => hook.id),
    ['other'],
  );
});

test('settings PATCH without a revision hint skips the stale check', async () => {
  const fx = plainSettings();
  const saved = await call(fx, '/api/settings', 'PATCH', { value: { density: 'compact' } });
  assert.equal(saved.status, 200);
  assert.deepEqual(fx.values.get('admin.settings'), { density: 'compact' });
  const unhandled = await call(fx, '/api/hooks/h1', 'GET');
  assert.equal(unhandled.handled, false);
  assert.equal((await call(fx, '/api/policy/network-rules/x', 'GET')).handled, false);
});
