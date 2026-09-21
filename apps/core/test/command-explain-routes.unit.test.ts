import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import { handleCommandExplainRoutes } from '../src/admin/routes/command-explain-routes.js';

function request(method: string, value?: unknown) {
  const text = value === undefined ? '' : JSON.stringify(value);
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

function fixture() {
  const workspaces = {
    getLocal: (id: string) =>
      id === 'w1' ? { id: 'w1', name: 'W1', hostRoot: '/tmp/work1' } : null,
    capabilityRoots: (id: string) =>
      id === 'w1'
        ? [
            {
              id: 'root',
              logicalPrefix: '/',
              hostRoot: '/tmp/work1',
              capabilities: ['commands.run'],
            },
          ]
        : [],
  };
  const permissions = {
    list: () => [],
  };
  const settings = {
    get: (_k: string, fb: any) => fb,
  };
  return { workspaces, permissions, settings } as any;
}

test('command explain routes ignores non-matching paths and methods', async () => {
  const context = fixture();
  const res = response();
  const urlOther = new URL('https://localhost/api/other');
  assert.equal(
    await handleCommandExplainRoutes(request('POST', {}), res, urlOther, context),
    false,
  );

  const urlExplain = new URL('https://localhost/api/policy/commands/explain');
  assert.equal(await handleCommandExplainRoutes(request('GET'), res, urlExplain, context), false);
});

test('command explain evaluates argv command with workspace context', async () => {
  const context = fixture();
  const res = response();
  const url = new URL('https://localhost/api/policy/commands/explain');

  const handled = await handleCommandExplainRoutes(
    request('POST', {
      workspaceId: 'w1',
      command: { executable: 'git', args: ['status'] },
    }),
    res,
    url,
    context,
  );

  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);
  const data = JSON.parse(res.body);
  assert.equal(data.ok, true);
  assert.equal(data.request.executable, 'git');
  assert.ok(data.analysis);
  assert.ok(data.decision);
});

test('command explain delegates actual-session evaluation to the runtime command evaluator', async () => {
  const context = fixture();
  const calls: any[] = [];
  context.commandEvaluator = async (input: any) => {
    calls.push(input);
    return {
      analysis: { requestFingerprint: 'runtime-analysis', nodes: [], scope: 'inside' },
      decision: { outcome: 'allow', reasons: [] },
    };
  };
  const res = response();
  const url = new URL('https://localhost/api/policy/commands/explain');

  await handleCommandExplainRoutes(
    request('POST', {
      workspaceId: 'w1',
      sessionId: 's1',
      command: { executable: 'git', args: ['status'], cwdLogical: '/packages/api' },
    }),
    res,
    url,
    context,
  );

  assert.equal(res.statusCode, 200);
  const data = JSON.parse(res.body);
  assert.equal(data.mode, 'runtime-session');
  assert.equal(data.analysis.requestFingerprint, 'runtime-analysis');
  assert.equal(data.decision.outcome, 'allow');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].sessionId, 's1');
  assert.equal(calls[0].workspaceId, 'w1');
  assert.equal(calls[0].request.cwdLogical, '/packages/api');
});

test('command explain rejects an explicitly missing workspace', async () => {
  const context = fixture();
  const res = response();
  const url = new URL('https://localhost/api/policy/commands/explain');

  await handleCommandExplainRoutes(
    request('POST', {
      workspaceId: 'missing',
      command: { executable: 'git', args: ['status'] },
    }),
    res,
    url,
    context,
  );

  assert.equal(res.statusCode, 404);
  assert.equal(JSON.parse(res.body).ok, false);
});

test('command explain evaluates script with yolo active and rules', async () => {
  const context = fixture();
  context.settings.get = (k: string, fb: any) =>
    k === 'policy.yolo' ? { active: true, mode: 'unrestricted' } : fb;
  const res = response();
  const url = new URL('https://localhost/api/policy/commands/explain');

  const handled = await handleCommandExplainRoutes(
    request('POST', {
      workspaceId: 'w1',
      script: 'echo test',
      networkDestinations: ['example.com'],
    }),
    res,
    url,
    context,
  );

  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);
  const data = JSON.parse(res.body);
  assert.equal(data.ok, true);
  assert.equal(data.decision.outcome, 'allow');
});

test('command explain handles npm script trust evaluation and errors gracefully', async () => {
  const context = fixture();
  const res = response();
  const url = new URL('https://localhost/api/policy/commands/explain');

  const handled = await handleCommandExplainRoutes(
    request('POST', {
      workspaceId: 'w1',
      command: { executable: 'npm', args: ['run', 'build'] },
    }),
    res,
    url,
    context,
  );

  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);
  const data = JSON.parse(res.body);
  assert.equal(data.ok, true);
  assert.ok(data.analysis);
});

test('command explain handles rules with object predicates and malformed JSON', async () => {
  const context = fixture();
  context.permissions.list = () => [
    {
      id: 'r_obj',
      capability: 'commands.run',
      predicate: {
        version: 2,
        application: 'git',
        operation: ['status'],
        allowedModifiers: [],
        allowedOptions: [],
        positionalConstraint: 'workspace-paths',
        targetScope: 'workspace',
      },
      scope: 'workspace',
      workspaceId: 'w1',
    },
    {
      id: 'r_bad_json',
      capability: 'commands.run',
      predicate_json: '{ invalid json',
    },
  ];

  const res = response();
  const url = new URL('https://localhost/api/policy/commands/explain');

  const handled = await handleCommandExplainRoutes(
    request('POST', {
      workspaceId: 'w1',
      executable: 'git',
      args: ['status'],
      yoloActive: true,
      yoloMode: 'unrestricted',
      criticalAlwaysConfirm: true,
    }),
    res,
    url,
    context,
  );

  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);
  const data = JSON.parse(res.body);
  assert.equal(data.ok, true);
  assert.ok(data.decision);
});

test('command explain returns error status when body is invalid JSON', async () => {
  const context = fixture();
  const res = response();
  const url = new URL('https://localhost/api/policy/commands/explain');

  const badStream = Readable.from([Buffer.from('not json')]) as any;
  badStream.method = 'POST';
  badStream.headers = {};

  const handled = await handleCommandExplainRoutes(badStream, res, url, context);
  assert.equal(handled, true);
  assert.equal(res.statusCode, 400);
  const data = JSON.parse(res.body);
  assert.equal(data.ok, false);
});

test('command explain handles predicate returning null and command.cwdLogical in hypothetical mode', async () => {
  const context = fixture();
  context.settings.get = () => undefined; // triggers ?? {}
  context.permissions.list = () => [
    {
      id: 'r_null',
      capability: 'commands.run',
      predicate_json: 'null',
    },
  ];

  const res = response();
  const url = new URL('https://localhost/api/policy/commands/explain');

  const handled = await handleCommandExplainRoutes(
    request('POST', {
      command: { cwdLogical: '/workspace/sub', executable: 'ls', args: ['-la'] },
    }),
    res,
    url,
    context,
  );

  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);
  const data = JSON.parse(res.body);
  assert.equal(data.ok, true);
});

test('command explain handles custom status error and string error', async () => {
  const context = fixture();
  context.permissions.list = () => {
    const err: any = new Error('custom status error');
    err.status = 418;
    throw err;
  };

  const res = response();
  const url = new URL('https://localhost/api/policy/commands/explain');
  await handleCommandExplainRoutes(request('POST', { script: 'test' }), res, url, context);
  assert.equal(res.statusCode, 418);

  const contextStr = fixture();
  contextStr.permissions.list = () => {
    throw 'string error';
  };
  const resStr = response();
  await handleCommandExplainRoutes(request('POST', { script: 'test' }), resStr, url, contextStr);
  assert.equal(resStr.statusCode, 500);
  assert.equal(JSON.parse(resStr.body).error, 'string error');
});
