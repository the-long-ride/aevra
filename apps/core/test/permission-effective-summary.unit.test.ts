import assert from 'node:assert/strict';
import test from 'node:test';
import { PermissionEngine } from '../src/policy/permissions.js';

function engine(rows: any[]) {
  return new PermissionEngine({ list: () => rows } as any);
}
function row(input: any) {
  return {
    id: input.id ?? Math.random().toString(36),
    effect: 'allow',
    capability: 'files.read',
    scope: 'workspace',
    workspace_id: 'w',
    actor: 'connector:ChatGPT',
    matcher: '*',
    created_at: new Date().toISOString(),
    ...input,
  };
}
const context = {
  workspaceId: 'w',
  actor: 'connector:ChatGPT',
  sessionId: 's',
  baselineCapabilities: ['files.read'] as any,
};

test('summary overlays wildcard non-command capability without broadening baseline', () => {
  const value = engine([row({ capability: 'files.write' })]).summary(context);
  assert.deepEqual(value.effectiveCapabilities, ['files.read', 'files.write']);
  assert.deepEqual(value.commandMatchers, []);
});

test('summary does not claim a non-command capability from a non-wildcard matcher', () => {
  const value = engine([row({ capability: 'files.write', matcher: 'files:write' })]).summary(
    context,
  );
  assert.deepEqual(value.effectiveCapabilities, ['files.read']);
});

test('summary exposes matcher-restricted commands', () => {
  const value = engine([row({ capability: 'commands.run', matcher: 'git:status' })]).summary(
    context,
  );
  assert.deepEqual(value.effectiveCapabilities, ['files.read', 'commands.run']);
  assert.deepEqual(value.commandMatchers, ['git:status']);
});

test('deny suppresses an otherwise allowed effective capability', () => {
  const value = engine([
    row({ id: 'allow', capability: 'files.write' }),
    row({ id: 'deny', effect: 'deny', capability: 'files.write' }),
  ]).summary(context);
  assert.deepEqual(value.effectiveCapabilities, ['files.read']);
});

test('deny wins for critical operations while critical allow still requires approval', () => {
  const denied = engine([
    row({ effect: 'deny', capability: 'files.delete', matcher: 'files:delete' }),
  ]).decide({
    capability: 'files.delete',
    matcher: 'files:delete',
    workspaceId: 'w',
    actor: 'connector:ChatGPT',
    sessionId: 's',
    risk: 'CRITICAL',
  });
  assert.equal(denied.outcome, 'deny');
  const allowed = engine([row({ capability: 'files.delete', matcher: 'files:delete' })]).decide({
    capability: 'files.delete',
    matcher: 'files:delete',
    workspaceId: 'w',
    actor: 'connector:ChatGPT',
    sessionId: 's',
    risk: 'CRITICAL',
  });
  assert.equal(allowed.outcome, 'approval');
});
