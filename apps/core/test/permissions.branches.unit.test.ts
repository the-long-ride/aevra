import assert from 'node:assert/strict';
import test from 'node:test';
import { PermissionEngine } from '../src/policy/permissions.js';

function engine(rows: any[]) {
  return new PermissionEngine({ list: () => rows } as any);
}

const base = {
  capability: 'commands.run' as const,
  matcher: 'git:status',
  risk: 'LOW' as const,
  workspaceId: 'ws1',
  actor: 'me',
  sessionId: 's1',
};

test('listRules maps snake_case and camelCase rows with defaults', () => {
  const [snake, camel] = engine([
    {
      id: 'a',
      effect: 'allow',
      capability: 'files.read',
      scope: 'workspace',
      workspace_id: 'ws1',
      session_id: 's1',
      matcher: '*',
      created_at: 'c1',
      last_used_at: 'u1',
      expires_at: 'e1',
      version: 2,
      status: 'needs-review',
      predicate_json: '{}',
    },
    {
      id: 'b',
      effect: 'deny',
      capability: 'files.read',
      scope: 'session',
      workspaceId: 'ws2',
      sessionId: 's2',
      actor: null,
      matcher: '*',
      createdAt: 'c2',
      lastUsedAt: 'u2',
      expiresAt: 'e2',
      predicateJson: '[]',
    },
  ]).listRules();
  assert.deepEqual(snake, {
    id: 'a',
    effect: 'allow',
    capability: 'files.read',
    scope: 'workspace',
    workspaceId: 'ws1',
    actor: undefined,
    sessionId: 's1',
    matcher: '*',
    createdAt: 'c1',
    lastUsedAt: 'u1',
    expiresAt: 'e1',
    version: 2,
    status: 'needs-review',
    predicate_json: '{}',
  });
  assert.equal(camel!.workspaceId, 'ws2');
  assert.equal(camel!.sessionId, 's2');
  assert.equal(camel!.createdAt, 'c2');
  assert.equal(camel!.lastUsedAt, 'u2');
  assert.equal(camel!.expiresAt, 'e2');
  assert.equal(camel!.version, 1);
  assert.equal(camel!.status, 'active');
  assert.equal(camel!.predicate_json, '[]');
});

test('applicability filters expiry, actor, workspace, session, and review status', () => {
  const rule = (extra: Record<string, unknown>) => ({
    id: 'r',
    effect: 'allow',
    capability: 'commands.run',
    scope: 'global',
    matcher: 'git:*',
    ...extra,
  });
  const decide = (extra: Record<string, unknown>) => engine([rule(extra)]).decide(base).outcome;
  assert.equal(decide({}), 'allow');
  assert.equal(decide({ expires_at: '2000-01-01T00:00:00.000Z' }), 'approval');
  assert.equal(decide({ expires_at: '2999-01-01T00:00:00.000Z' }), 'allow');
  assert.equal(decide({ actor: 'other' }), 'approval');
  assert.equal(decide({ actor: 'me' }), 'allow');
  assert.equal(decide({ scope: 'workspace', workspace_id: 'ws2' }), 'approval');
  assert.equal(decide({ scope: 'workspace', workspace_id: 'ws1' }), 'allow');
  assert.equal(decide({ workspace_id: 'ws2' }), 'approval');
  assert.equal(decide({ workspace_id: 'ws1' }), 'allow');
  assert.equal(decide({ scope: 'session', session_id: 's2' }), 'approval');
  assert.equal(decide({ scope: 'session', session_id: 's1' }), 'allow');
  assert.equal(decide({ session_id: 's2' }), 'approval');
  assert.equal(decide({ session_id: 's1' }), 'allow');
  assert.equal(decide({ status: 'needs-review' }), 'approval');
  assert.equal(decide({ status: 'needs-review', effect: 'deny' }), 'deny');
});

test('decide prefers specific scopes and matchers, deny on ties, then id order', () => {
  const rows = [
    { id: 'g-allow', effect: 'allow', capability: 'commands.run', scope: 'global', matcher: '*' },
    {
      id: 's-deny',
      effect: 'deny',
      capability: 'commands.run',
      scope: 'session',
      session_id: 's1',
      matcher: 'git:*',
    },
  ];
  assert.deepEqual(engine(rows).decide(base), {
    outcome: 'deny',
    ruleId: 's-deny',
    reason: 'matched session deny rule',
  });
  const tie = [
    {
      id: 'b',
      effect: 'allow',
      capability: 'commands.run',
      scope: 'global',
      matcher: 'git:status',
    },
    {
      id: 'a',
      effect: 'allow',
      capability: 'commands.run',
      scope: 'global',
      matcher: 'git:status',
    },
    { id: 'c', effect: 'deny', capability: 'commands.run', scope: 'global', matcher: 'git:status' },
  ];
  assert.equal(engine(tie).decide(base).ruleId, 'c');
  assert.equal(engine(tie.slice(0, 2)).decide(base).ruleId, 'a');
  assert.equal(engine([tie[2], tie[0]]).decide(base).ruleId, 'c');
  const specific = [
    { id: 'wild', effect: 'deny', capability: 'commands.run', scope: 'global', matcher: 'git:*' },
    {
      id: 'exact',
      effect: 'allow',
      capability: 'commands.run',
      scope: 'global',
      matcher: 'git:status',
    },
  ];
  assert.deepEqual(engine(specific).decide(base), {
    outcome: 'allow',
    ruleId: 'exact',
    reason: 'matched global allow rule',
  });
  assert.equal(
    engine([{ ...specific[1], matcher: 'npm.(x)' }]).decide({ ...base, matcher: 'npmA(x)' })
      .outcome,
    'approval',
  );
  assert.equal(engine([specific[1]]).decide({ ...base, risk: 'CRITICAL' }).outcome, 'approval');
  assert.equal(
    engine([specific[1]]).decide({ ...base, capability: 'git.push' }).reason,
    'no remembered permission rule',
  );
});

test('summary combines baseline, wildcard denies, allows, and command matchers', () => {
  const summary = engine([
    { id: '1', effect: 'deny', capability: 'files.write', scope: 'global', matcher: '*' },
    { id: '2', effect: 'allow', capability: 'git.push', scope: 'global', matcher: '*' },
    { id: '3', effect: 'allow', capability: 'network', scope: 'global', matcher: 'host:example' },
    {
      id: '4',
      effect: 'allow',
      capability: 'commands.run',
      scope: 'global',
      matcher: 'git:status',
    },
    {
      id: '5',
      effect: 'allow',
      capability: 'commands.run',
      scope: 'workspace',
      workspace_id: 'ws1',
      matcher: 'git:status',
    },
    { id: '6', effect: 'allow', capability: 'commands.run', scope: 'global', matcher: 'rm:all' },
    { id: '7', effect: 'deny', capability: 'commands.run', scope: 'global', matcher: 'rm:*' },
    { id: '8', effect: 'allow', capability: 'files.delete', scope: 'global', matcher: '*' },
    { id: '9', effect: 'deny', capability: 'files.delete', scope: 'global', matcher: '*' },
  ]).summary({ workspaceId: 'ws1', baselineCapabilities: ['files.read', 'files.write'] });
  assert.deepEqual(summary, {
    effectiveCapabilities: ['files.read', 'commands.run', 'git.push'],
    commandMatchers: ['git:status'],
  });
  const none = engine([
    { id: '7', effect: 'deny', capability: 'commands.run', scope: 'global', matcher: '*' },
  ]).summary({ baselineCapabilities: ['commands.run'] });
  assert.deepEqual(none, { effectiveCapabilities: [], commandMatchers: [] });
});
