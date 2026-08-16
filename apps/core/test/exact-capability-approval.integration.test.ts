import assert from 'node:assert/strict';
import test from 'node:test';
import { AdminServer } from '../src/admin/server.js';

const bootstrap = { validateSession: (value: string | undefined) => value === 'keep-me' } as any;
async function approve(scope: string, ticket: any) {
  const rules: any[] = [];
  const approvals = {
    status: () => ticket,
    approve: (_id: string, decisionScope: string) => ({
      ...ticket,
      state: 'APPROVED',
      decisionScope,
    }),
    deny: () => ticket,
  };
  const permissions = {
    upsert: (rule: any) => {
      rules.push(rule);
      return rule;
    },
  };
  const server = new AdminServer('127.0.0.1', 0, () => ({ core: 'running' }), {
    bootstrap,
    api: { approvals, permissions } as any,
  });
  await server.start();
  try {
    const response = await fetch(`${server.url()}/api/approvals/req/approve`, {
      method: 'POST',
      headers: {
        cookie: 'aevra_admin=keep-me',
        origin: server.url(),
        'sec-fetch-site': 'same-origin',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ scope }),
    });
    assert.equal(response.status, 200);
    return rules;
  } finally {
    await server.close();
  }
}
function ticket(overrides: any = {}) {
  return {
    id: 'req',
    actor: 'oauth:ChatGPT',
    sessionId: 'ses',
    workspaceId: 'ws',
    operation: {
      family: 'capability:files.write',
      capability: 'files.write',
      risk: 'MEDIUM',
      argsHash: 'h',
    },
    payload: {
      tool: 'capability_request',
      requestedCapability: 'files.write',
      permissionMatcher: '*',
    },
    expectedState: { workspaceId: 'ws' },
    risk: 'MEDIUM',
    state: 'PENDING',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    ...overrides,
  };
}

test('workspace approval persists only exact requested files.write capability', async () => {
  const rules = await approve('workspace', ticket());
  assert.equal(rules.length, 1);
  assert.equal(rules[0].capability, 'files.write');
  assert.equal(rules[0].matcher, '*');
  assert.equal(rules[0].workspaceId, 'ws');
  assert.equal(rules[0].actor, 'oauth:ChatGPT');
});
test('session command approval persists exact command matcher and session', async () => {
  const rules = await approve(
    'session',
    ticket({
      operation: { family: 'git:status', capability: 'commands.run', risk: 'LOW', argsHash: 'h' },
      payload: {
        tool: 'capability_request',
        requestedCapability: 'commands.run',
        permissionMatcher: 'git:status',
      },
      risk: 'LOW',
    }),
  );
  assert.equal(rules.length, 1);
  assert.equal(rules[0].capability, 'commands.run');
  assert.equal(rules[0].matcher, 'git:status');
  assert.equal(rules[0].sessionId, 'ses');
});
test('critical approval never persists an always rule', async () => {
  const rules = await approve(
    'workspace',
    ticket({
      operation: {
        family: 'capability:files.delete',
        capability: 'files.delete',
        risk: 'CRITICAL',
        argsHash: 'h',
      },
      payload: {
        tool: 'capability_request',
        requestedCapability: 'files.delete',
        permissionMatcher: '*',
      },
      risk: 'CRITICAL',
    }),
  );
  assert.deepEqual(rules, []);
});
