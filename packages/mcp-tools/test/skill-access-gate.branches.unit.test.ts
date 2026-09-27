import assert from 'node:assert/strict';
import test from 'node:test';
import { SessionSkillAccessGate } from '../src/skill-access-gate.js';

const FAMILY = 'skills:read';

function skillTicket(id: string, state: string, overrides: any = {}) {
  return {
    id,
    actor: 'oauth:ChatGPT',
    sessionId: 's1',
    workspaceId: 'local-skills',
    operation: { family: FAMILY, capability: 'skills.read', risk: 'MEDIUM', argsHash: 'h' },
    state,
    expiresAt: new Date(Date.now() + 30_000).toISOString(),
    ...overrides,
  };
}

function fixture(options: any = {}) {
  const calls: Array<[string, any]> = [];
  const tickets = new Map<string, any>();
  for (const t of options.tickets ?? []) tickets.set(t.id, t);
  const requests: any[] = [];
  const session = { id: 's1', actor: options.actor ?? 'oauth:ChatGPT' };
  const sessions: any = {
    get: (id: string) => (id === 's1' ? session : null),
    leases: () => options.leases ?? [],
    activeLease: () => options.leases?.[0] ?? null,
    isYolo: () => Boolean(options.yolo),
  };
  const approvals: any = {
    list: () => [...tickets.values()],
    status: (id: string) => (options.statusOverride ? options.statusOverride(id) : tickets.get(id)),
    request: async (input: any) => {
      requests.push(input);
      const r = options.requestResult ?? { status: 'approval_pending', requestId: 'new' };
      tickets.set(
        r.requestId,
        skillTicket(r.requestId, r.status === 'approved' ? 'APPROVED' : 'PENDING'),
      );
      return r;
    },
    resume: async (id: string, validate: any, execute: any) => {
      const t = options.statusOverride ? options.statusOverride(id) : tickets.get(id);
      const check = await validate(t);
      if (!check.ok) return check;
      const value = await execute(t);
      t.state = 'SUCCEEDED';
      return value;
    },
  };
  const inner: any = {
    async call(sessionId: string, name: string, args: any) {
      calls.push([name, args]);
      if (options.innerCall) return options.innerCall(name, args);
      return { name, sessionId };
    },
    ...options.inner,
  };
  const gate = new SessionSkillAccessGate(inner, sessions, approvals);
  return { gate, calls, requests, tickets };
}

test('approval_wait without a skill ticket is forwarded to the inner service', async () => {
  const f = fixture();
  const result = await f.gate.call('s1', 'approval_wait');
  assert.equal(result.name, 'approval_wait');
  assert.deepEqual(f.calls, [['approval_wait', {}]]);
});

test('approval_wait on a pending skill ticket returns the ticket without granting', async () => {
  const pending = skillTicket('t1', 'PENDING');
  const f = fixture({ tickets: [pending] });
  assert.equal(await f.gate.call('s1', 'approval_wait', { requestId: 't1' }), pending);
  assert.deepEqual(await f.gate.resourcesList('s1'), { resources: [] });
});

test('resume refuses a skill approval when the session actor changed', async () => {
  const approved = skillTicket('t1', 'APPROVED', { actor: 'oauth:Someone' });
  const f = fixture({ tickets: [approved] });
  assert.deepEqual(await f.gate.call('s1', 'approval_wait', { requestId: 't1' }), {
    ok: false,
    reason: 'session changed',
  });
  assert.deepEqual(await f.gate.resourcesList('s1'), { resources: [] });
});

test('yolo sessions skip the approval request and missing optional inner methods fall back', async () => {
  const f = fixture({ yolo: true });
  assert.equal((await f.gate.call('s1', 'skills_list', {})).name, 'skills_list');
  assert.equal(f.requests.length, 0);
  assert.deepEqual(await f.gate.resourcesList('s1'), { resources: [] });
  assert.deepEqual(await f.gate.promptsList(), { prompts: [] });
  assert.deepEqual(await f.gate.upstreamToolDefinitions(), []);
});

test('upstream definitions and proxied resources and prompts delegate to the inner service', async () => {
  const f = fixture({
    inner: {
      upstreamToolDefinitions: () => [{ name: 'docs__search' }],
      resourceRead: async (_s: string, uri: string) => ({ proxied: uri }),
      promptGet: async (_s: string, name: string) => ({ proxied: name }),
    },
  });
  assert.deepEqual(await f.gate.upstreamToolDefinitions(), [{ name: 'docs__search' }]);
  assert.deepEqual(await f.gate.resourceRead('s1', 'mcp+docs://page/1'), {
    proxied: 'mcp+docs://page/1',
  });
  assert.deepEqual(await f.gate.promptGet('s1', 'docs__intro'), { proxied: 'docs__intro' });
  assert.equal(f.requests.length, 0, 'proxied entries never ask for local skill access');

  const bare = fixture();
  await assert.rejects(
    () => bare.gate.resourceRead('s1', 'mcp+docs://page/1'),
    /Upstream resources are unavailable/,
  );
  await assert.rejects(
    () => bare.gate.promptGet('s1', 'docs__intro'),
    /Upstream prompts are unavailable/,
  );
});

test('promptGet without a lease raises APPROVAL_PENDING with the new request id', async () => {
  const f = fixture();
  await assert.rejects(
    () => f.gate.promptGet('s1'),
    (e: any) => e.code === 'APPROVAL_PENDING' && e.details.requestId === 'new',
  );
  assert.equal(f.requests[0].operation.capability, 'skills.read');
  assert.equal(f.requests[0].payload.tool, 'skills_access');
  assert.equal(f.calls.length, 0);
});

test('inner capability approvals surface as APPROVAL_PENDING on resource and prompt reads', async () => {
  const lease = { workspaceId: 'w1', capabilities: ['skills.read'] };
  const f = fixture({
    leases: [lease],
    innerCall: () => ({ status: 'approval_pending', requestId: 'cap1' }),
  });
  await assert.rejects(
    () => f.gate.resourceRead('s1', 'aevra://skill/user/demo'),
    (e: any) =>
      e.code === 'APPROVAL_PENDING' &&
      e.details.requestId === 'cap1' &&
      e.details.scope === 'session',
  );
  const scoped = fixture({
    leases: [lease],
    innerCall: () => ({ status: 'approval_pending', requestId: 'cap2', scope: 'workspace' }),
  });
  await assert.rejects(
    () => scoped.gate.promptGet('s1'),
    (e: any) => e.details.requestId === 'cap2' && e.details.scope === 'workspace',
  );
});

test('resourceRead decodes the skill name and rejects non-string content', async () => {
  const lease = { workspaceId: 'w1', capabilities: [] };
  const f = fixture({ leases: [lease], innerCall: () => ({ content: 42 }) });
  await assert.rejects(
    () => f.gate.resourceRead('s1', 'aevra://skill/workspace/my%20skill'),
    (e: any) => e.code === 'SKILL_NOT_FOUND',
  );
  assert.deepEqual(f.calls[0], ['skill_read', { source: 'workspace', name: 'my skill' }]);
  const empty = fixture({ leases: [lease], innerCall: () => null });
  await assert.rejects(() => empty.gate.resourceRead('s1', 'aevra://skill/user/x'), /unavailable/);
});

test('an earlier SUCCEEDED skill ticket grants the session without a new request', async () => {
  const f = fixture({ tickets: [skillTicket('old', 'SUCCEEDED')] });
  assert.equal((await f.gate.call('s1', 'skill_read', { name: 'x' })).name, 'skill_read');
  assert.equal(f.requests.length, 0);
  assert.deepEqual(await f.gate.resourcesList('s1'), { resources: [] }, 'no inner list method');
});

test('a listed ticket missing from status() is evaluated from the list snapshot', async () => {
  const listed = skillTicket('old', 'SUCCEEDED');
  const f = fixture({ tickets: [listed], statusOverride: () => undefined });
  assert.equal((await f.gate.call('s1', 'instructions_read', {})).name, 'instructions_read');
  assert.equal(f.requests.length, 0);
});

test('tickets of other states or sessions fall through to a fresh request', async () => {
  const f = fixture({
    tickets: [
      skillTicket('other', 'SUCCEEDED', { sessionId: 's9' }),
      skillTicket('expired', 'EXPIRED'),
    ],
  });
  const pending: any = await f.gate.call('s1', 'skills_list', {});
  assert.equal(pending.status, 'approval_pending');
  assert.equal(pending.requestId, 'new');
  assert.ok(pending.expiresInSeconds > 0 && pending.expiresInSeconds <= 30);
  assert.equal(f.requests.length, 1);
});

test('an immediately approved request resumes and grants, even if status is gone', async () => {
  const f = fixture({ requestResult: { status: 'approved', requestId: 'auto' } });
  assert.equal((await f.gate.call('s1', 'skills_list', {})).name, 'skills_list');
  assert.equal(f.tickets.get('auto').state, 'SUCCEEDED');
  assert.equal(f.requests.length, 1);

  const vanished = fixture({
    requestResult: { status: 'approved', requestId: 'ghost' },
    statusOverride: () => undefined,
  });
  assert.equal((await vanished.gate.call('s1', 'skills_list', {})).name, 'skills_list');
});

test('a pending request whose ticket cannot be found is reported as APPROVAL_PENDING', async () => {
  const f = fixture({ statusOverride: () => undefined });
  await assert.rejects(
    () => f.gate.call('s1', 'skills_list', {}),
    (e: any) => e.code === 'APPROVAL_PENDING' && /was not found/.test(e.message),
  );
});

test('non-skill tickets returned while resuming are delegated to inner approval_wait', async () => {
  const f = fixture({
    requestResult: { status: 'approved', requestId: 'x' },
    statusOverride: () => skillTicket('x', 'APPROVED', { operation: { family: 'files:write' } }),
  });
  await f.gate.call('s1', 'skills_list', {});
  assert.deepEqual(f.calls[0], ['approval_wait', { requestId: 'x' }]);
  assert.equal(f.calls[1][0], 'skills_list');
});
