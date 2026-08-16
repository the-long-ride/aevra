import assert from 'node:assert/strict';
import test from 'node:test';
import {
  authorizationContext,
  requiredLease,
  resolveWorkspaceLease,
  workspaceRoot,
} from '../src/service-helpers.js';

import { workspaceSelect } from '../src/authorization.js';

function fixture(
  options: {
    actor?: string;
    capabilities?: string[];
    switchResult?: any;
    bindings?: any;
  } = {},
) {
  const requests: any[] = [];
  const lease: any = {
    id: 'l1',
    workspaceId: 'w1',
    actor: options.actor ?? 'oauth:ChatGPT',
    capabilities: options.capabilities ?? [],
    expiresAt: 'later',
  };
  const session: any = { id: 's1', actor: options.actor ?? 'oauth:ChatGPT', subject: 'subject' };
  const sessions: any = {
    get: () => session,
    activeLease: () => lease,
    leaseForWorkspace: (_s: string, id: string) => (id === lease.workspaceId ? lease : null),
    leases: () => [lease],
    isYolo: () => false,
    switchWorkspace: async (...args: any[]) =>
      options.switchResult ?? { status: 'admitted', lease: { ...lease, workspaceId: args[1] } },
    connectionIdentity: () => ({ actor: session.actor, subject: session.subject }),
  };
  const workspaces: any = {
    getLocal: (value: string) =>
      value === 'w1' || value === 'One'
        ? { id: 'w1', name: 'One', description: 'desc', hostRoot: '/root' }
        : value === 'w2' || value === 'Two'
          ? { id: 'w2', name: 'Two', description: 'desc2', hostRoot: '/root2' }
          : null,
  };
  const approvals: any = {
    request: async (input: any) => {
      requests.push(input);
      return { status: 'approval_pending', requestId: 'req1' };
    },
  };
  const context: any = {
    sessions,
    workspaces,
    approvals,
    deps: {
      connectorBindings: () => options.bindings ?? null,
      settings: { get: () => false },
    },
  };
  return { context, requests, lease, session, approvals };
}

test('service-helpers authorizationContext and requiredLease validations', () => {
  const fx = fixture();

  assert.throws(
    () => requiredLease(fx.context, 's1', 'commands.run'),
    (e: any) => e.code === 'CAPABILITY_REQUIRED',
  );

  const switchingFx = fixture();
  switchingFx.context.sessions.isSwitching = () => true;
  assert.throws(
    () => requiredLease(switchingFx.context, 's1'),
    (e: any) => e.code === 'SESSION_WORKSPACE_REQUIRED' && /draining/.test(e.message),
  );

  const multiLeaseFx = fixture();
  multiLeaseFx.context.sessions.activeLease = () => null;
  multiLeaseFx.context.sessions.leases = () => [{ workspaceId: 'w1' }, { workspaceId: 'w2' }];
  assert.throws(
    () => requiredLease(multiLeaseFx.context, 's1'),
    (e: any) => e.code === 'WORKSPACE_REQUIRED',
  );

  const noLeaseFx = fixture();
  noLeaseFx.context.sessions.activeLease = () => null;
  noLeaseFx.context.sessions.leases = () => [];
  assert.throws(
    () => requiredLease(noLeaseFx.context, 's1'),
    (e: any) => e.code === 'SESSION_WORKSPACE_REQUIRED',
  );

  const nullSessionFx = fixture();
  nullSessionFx.context.sessions.get = () => null;
  assert.throws(
    () => authorizationContext(nullSessionFx.context, 's1', 'files.read', '*'),
    (e: any) => e.code === 'UNAUTHORIZED',
  );

  assert.throws(
    () => resolveWorkspaceLease(fx.context, 's1', { workspace: 'w2' }),
    (e: any) => e.code === 'WORKSPACE_ACCESS_REQUIRED',
  );

  assert.throws(
    () => resolveWorkspaceLease(noLeaseFx.context, 's1', {}),
    (e: any) => e.code === 'SESSION_WORKSPACE_REQUIRED',
  );

  assert.throws(
    () => workspaceRoot(multiLeaseFx.context, 's1'),
    (e: any) => e.code === 'WORKSPACE_REQUIRED',
  );

  assert.equal(workspaceRoot(noLeaseFx.context, 's1'), null);
});

test('workspace select covers not-found current admission connector binding and pending request profiles', async () => {
  const notFound = fixture();
  await assert.rejects(
    () => workspaceSelect(notFound.context, 's1', { workspace: 'missing' }),
    (e: any) => e.code === 'NOT_FOUND',
  );

  const current = fixture({ capabilities: ['files.read'] });
  const selected: any = await workspaceSelect(current.context, 's1', { workspace: 'w1' });
  assert.equal(selected.status, 'selected');
  assert.equal(current.requests.length, 0);

  const admitted = fixture();
  admitted.context.sessions.activeLease = () => null;
  const switched: any = await workspaceSelect(admitted.context, 's1', {
    name: 'Two',
    drainTimeoutMs: -4,
  });
  assert.equal(switched.workspace.id, 'w2');

  const bound = fixture({
    actor: 'connector:CLI',
    bindings: { workspaceId: 'w1', profileCap: 'read-only' },
  });
  bound.context.sessions.activeLease = () => null;
  await assert.rejects(
    () => workspaceSelect(bound.context, 's1', { id: 'w2' }),
    (e: any) => e.code === 'CAPABILITY_REQUIRED',
  );

  const pendingOauth = fixture({ switchResult: { status: 'approval_required' } });
  pendingOauth.context.sessions.activeLease = () => null;
  const pending: any = await workspaceSelect(pendingOauth.context, 's1', {
    workspace: 'w2',
    drainTimeoutMs: 'bad',
  });
  assert.equal(pending.status, 'approval_pending');
  assert.equal(pendingOauth.requests[0].payload.profileId, 'read-only');
  assert.equal(pendingOauth.requests[0].payload.drainTimeoutMs, 0);

  const pendingConnector = fixture({
    actor: 'connector:CLI',
    switchResult: { status: 'approval_required' },
  });
  pendingConnector.context.sessions.activeLease = () => null;
  await workspaceSelect(pendingConnector.context, 's1', { workspace: 'w2' });
  assert.equal(pendingConnector.requests[0].payload.profileId, 'developer');

  const noApprovals = fixture({ switchResult: { status: 'approval_required' } });
  noApprovals.context.sessions.activeLease = () => null;
  noApprovals.context.approvals = undefined;
  await assert.rejects(
    () => workspaceSelect(noApprovals.context, 's1', { workspace: 'w2' }),
    (e: any) => e.code === 'APPROVAL_PENDING',
  );
});
