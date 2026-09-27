import assert from 'node:assert/strict';
import test from 'node:test';
import { SecurityGuard } from '../src/security/security-guard.js';

const input = (extra: Record<string, unknown> = {}): any => ({
  sessionId: 's1',
  capability: 'files.read',
  operation: 'read',
  logicalPath: 'src/a.ts',
  mutation: false,
  ...extra,
});

function guard(opts: { session?: boolean; active?: string | null; byWorkspace?: boolean; local?: boolean; patterns?: any[] } = {}) {
  const sessions: any = {
    get: () => (opts.session === false ? null : { actor: 'a', subject: 'b' }),
    activeLease: () => (opts.active === null ? null : { workspaceId: opts.active ?? 'ws1' }),
  };
  if (opts.byWorkspace) sessions.leaseForWorkspace = (_s: string, ws: string) => (ws === 'ws2' ? { workspaceId: 'ws2' } : null);
  return new SecurityGuard(
    sessions,
    { getLocal: () => (opts.local === false ? null : {}) },
    opts.patterns ? { patternsFor: () => opts.patterns! } : undefined,
  );
}

const code = (expected: string) => (error: any) => error.code === expected;

test('authorizeResource resolves leases through each lookup path', () => {
  assert.throws(() => guard({ session: false }).authorizeResource(input()), code('UNAUTHORIZED'));
  assert.throws(() => guard({ active: null }).authorizeResource(input()), code('SESSION_WORKSPACE_REQUIRED'));
  assert.throws(() => guard().authorizeResource(input({ workspaceId: 'ws9' })), code('WORKSPACE_ACCESS_REQUIRED'));
  assert.equal(guard().authorizeResource(input({ workspaceId: 'ws1' })).workspaceId, 'ws1');
  assert.equal(guard({ byWorkspace: true }).authorizeResource(input({ workspaceId: 'ws2' })).workspaceId, 'ws2');
  assert.throws(() => guard({ byWorkspace: true }).authorizeResource(input({ workspaceId: 'ws1' })), /Workspace access required/);
  assert.throws(() => guard({ local: false }).authorizeResource(input()), code('NOT_FOUND'));
});

test('decisions follow sensitivity and mutation, with secret patterns ranked first', () => {
  assert.deepEqual(guard().authorizeResource(input()), { workspaceId: 'ws1', capability: 'files.read', sensitivity: 'NORMAL', decision: 'allow' });
  const patterns = [
    { pattern: /notes\//, class: 'SENSITIVE' },
    { pattern: /notes\/private/, class: 'SECRET' },
    { pattern: /docs\//, class: 'SENSITIVE' },
  ];
  const g = guard({ patterns });
  assert.equal(g.authorizeResource(input({ logicalPath: 'notes/private.md' })).decision, 'deny');
  assert.equal(g.authorizeResource(input({ logicalPath: 'docs/a.md' })).decision, 'allow');
  assert.deepEqual(g.authorizeResource(input({ logicalPath: 'docs/a.md', mutation: true })), {
    workspaceId: 'ws1',
    capability: 'files.read',
    sensitivity: 'SENSITIVE',
    decision: 'approval-required',
    approvalScope: 'once',
  });
  assert.equal(guard({ patterns: [patterns[0], patterns[2]] }).authorizeResource(input({ logicalPath: 'notes/x' })).sensitivity, 'SENSITIVE');
});
