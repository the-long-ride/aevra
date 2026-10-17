import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import { handleAgentRoutes } from '../src/admin/routes/agent-routes.js';

async function post(context: any, value: unknown) {
  const stream = Readable.from([Buffer.from(JSON.stringify(value))]) as any;
  stream.method = 'POST';
  stream.headers = {};
  const res: any = { statusCode: 0, body: '', setHeader() {}, once() {} };
  res.end = (text = '') => (res.body = String(text));
  await handleAgentRoutes(stream, res, new URL('https://localhost/api/agents'), context);
  return { status: res.statusCode, value: res.body ? JSON.parse(res.body) : undefined };
}

function fixture() {
  const inputs: any[] = [];
  const audits: any[] = [];
  const context: any = {
    agents: async (input: any) => {
      inputs.push(input);
      const target = input.credentialId ? 'codex' : (input.target ?? 'codex');
      return {
        message: 'done',
        registrations: [],
        notes: [],
        changes: [],
        results: [{ target, ok: true }],
      };
    },
    workspaces: { getLocal: () => null, listLocal: () => [] },
    audit: { append: (row: any) => audits.push(row) },
  };
  return { context, inputs, audits };
}

test('the scope is forwarded as sent and an absent scope is not turned into user', async () => {
  const fx = fixture();
  await post(fx.context, { operation: 'uninstall', target: 'all', scope: 'user' });
  await post(fx.context, { operation: 'uninstall', target: 'all', scope: 'all' });
  await post(fx.context, { operation: 'uninstall', target: 'all' });
  await post(fx.context, { operation: 'install', targets: ['codex'] });
  assert.deepEqual(
    fx.inputs.map((input) => input.scope),
    ['user', 'all', undefined, undefined],
  );
  assert.equal('scope' in fx.inputs[2], false);
  assert.deepEqual(
    fx.audits.map((row) => row.scope),
    ['user', 'all', 'all', 'user'],
  );
});

test('uninstall by credentialId forwards only the id and audits the agent it removed', async () => {
  const fx = fixture();
  const out = await post(fx.context, {
    operation: 'uninstall',
    credentialId: 'cred-heron-2',
    target: 'all',
    workspaceRoot: 'D:\\somewhere\\else',
  });
  assert.equal(out.status, 200);
  assert.deepEqual(fx.inputs, [
    {
      operation: 'uninstall',
      credentialId: 'cred-heron-2',
      transport: undefined,
      dryRun: undefined,
    },
  ]);
  assert.deepEqual(
    fx.audits.map((row) => [row.operation, row.target, row.scope, row.result]),
    [['agent.uninstall', 'codex', 'registration', 'ok']],
  );
});

test('a credentialId is refused for install, with targets, a scope or a workspace', async () => {
  const fx = fixture();
  const bad = [
    { operation: 'install', credentialId: 'cred-heron-2' },
    { operation: 'uninstall', credentialId: 7 },
    { operation: 'uninstall', credentialId: 'cred-heron-2', targets: ['codex'] },
    { operation: 'uninstall', credentialId: 'cred-heron-2', scope: 'workspace' },
    { operation: 'uninstall', credentialId: 'cred-heron-2', workspaceId: 'w1' },
  ];
  for (const value of bad) {
    const out = await post(fx.context, value);
    assert.equal(out.status, 400, JSON.stringify(value));
    assert.equal(out.value.error.code, 'AGENT_OPTIONS_INVALID');
  }
  assert.deepEqual(fx.inputs, []);
  assert.deepEqual(fx.audits, []);
});
