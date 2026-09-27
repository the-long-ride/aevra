import assert from 'node:assert/strict';
import test from 'node:test';
import { handleBasicTool } from '../src/basic-tools.js';
import { oneTimeKey } from '../src/service-helpers.js';

function fixture(o: any = {}) {
  const requests: any[] = [];
  const writes: any[] = [];
  const leases = o.leases ?? [{ id: 'l1', workspaceId: 'w1', capabilities: o.capabilities ?? [] }];
  const context: any = {
    sessions: {
      get: () => ({ id: 's1', actor: 'oauth:ChatGPT', subject: 'subject' }),
      activeLease: () => (leases.length === 1 ? leases[0] : null),
      leases: () => leases,
      leaseForWorkspace: (_s: string, id: string) => leases.find((l: any) => l.workspaceId === id) ?? null,
      isYolo: () => false,
    },
    workspaces: {
      listRemote: () => o.remote ?? [],
      getLocal: () => null,
    },
    approvals: {
      status: o.status ?? (() => null),
      cancel: o.cancel ?? (() => null),
      request: async (input: any) => {
        requests.push(input);
        return { status: 'approval_pending', requestId: `r${requests.length}` };
      },
    },
    deps: {
      ...(o.skills === false
        ? {}
        : {
            skills: {
              writeInstructions: (...args: any[]) => (writes.push(args), { ok: true }),
            },
          }),
      ...(o.manifests ? { manifests: o.manifests } : {}),
    },
    oneTimeCapabilities: new Set<string>(o.oneTime ?? []),
  };
  return { context, requests, writes };
}

test('skill and instruction reads return the capability approval when the lease lacks it', async () => {
  const f = fixture();
  const list: any = await handleBasicTool(f.context, 's1', 'skills_list', {});
  assert.equal(list.status, 'approval_pending');
  assert.equal(list.requiredCapability, 'skills.read');
  const read: any = await handleBasicTool(f.context, 's1', 'skill_read', {});
  assert.equal(read.permissionMatcher, 'user::SKILL.md', 'missing name becomes an empty segment');
  const instructions: any = await handleBasicTool(f.context, 's1', 'instructions_read', {});
  assert.equal(instructions.requiredCapability, 'instructions.read');
  assert.equal(f.requests.length, 3);
});

test('skill_write without a name asks for the write capability on the default matcher', async () => {
  const f = fixture();
  const result: any = await handleBasicTool(f.context, 's1', 'skill_write', { source: 'x' });
  assert.equal(result.requiredCapability, 'skills.write');
  assert.equal(result.permissionMatcher, 'user::SKILL.md');
});

test('skills_list with no workspace skips authorization and tolerates missing skills', async () => {
  const f = fixture({ leases: [], skills: false });
  assert.deepEqual(await handleBasicTool(f.context, 's1', 'skills_list', {}), {
    skills: [],
    total: 0,
    offset: 0,
    limit: 0,
  });
  assert.equal(f.requests.length, 0);
});

test('instructions_write with a one-time grant writes empty content by default', async () => {
  const f = fixture({
    capabilities: ['instructions.write'],
    oneTime: [oneTimeKey('s1', 'instructions.write', 'user')],
  });
  assert.deepEqual(await handleBasicTool(f.context, 's1', 'instructions_write', {}), { ok: true });
  assert.deepEqual(f.writes, [['user', null, '']]);
});

test('approval status and cancel hide tickets from other sessions and missing cancels', async () => {
  const foreign = { id: 'r', actor: 'oauth:Other', sessionId: 's9', state: 'PENDING' };
  const f = fixture({ status: () => foreign });
  assert.deepEqual(await handleBasicTool(f.context, 's1', 'approval_status', { requestId: 'r' }), {
    status: 'not_found',
  });
  assert.deepEqual(await handleBasicTool(f.context, 's1', 'approval_cancel', { requestId: 'r' }), {
    status: 'not_found',
  });
  const missing = fixture();
  assert.deepEqual(await handleBasicTool(missing.context, 's1', 'approval_cancel', { requestId: 'r' }), {
    status: 'not_found',
  });
  const own = { id: 'r', actor: 'oauth:ChatGPT', sessionId: 's1', state: 'PENDING' };
  const gone = fixture({ status: () => own, cancel: () => undefined });
  assert.deepEqual(await handleBasicTool(gone.context, 's1', 'approval_cancel', { requestId: 'r' }), {
    status: 'not_found',
  });
});

test('approval_wait hides authorization drift but rethrows other failures', async () => {
  for (const error of [
    Object.assign(new Error('x'), { code: 'APPROVAL_UNAUTHORIZED' }),
    new Error('OAuth connection changed'),
    new Error('session changed'),
  ]) {
    const f = fixture({
      status: () => {
        throw error;
      },
    });
    assert.equal(await handleBasicTool(f.context, 's1', 'approval_wait', { requestId: 'r' }), null);
  }
  const broken = fixture({
    status: () => {
      throw new Error('store offline');
    },
  });
  await assert.rejects(
    () => handleBasicTool(broken.context, 's1', 'approval_wait', { requestId: 'r' }),
    /store offline/,
  );
});

test('status and current workspace tolerate a lease whose workspace is no longer listed', async () => {
  const f = fixture({ capabilities: ['files.read'] });
  const status: any = await handleBasicTool(f.context, 's1', 'aevra_status', {});
  assert.equal(status.workspace, null);
  assert.deepEqual(status.workspaces[0].name, 'w1');
  assert.deepEqual(await handleBasicTool(f.context, 's1', 'workspace_current', {}), {
    status: 'none',
    workspace: null,
  });
});

test('workspace_current summarizes a manifest with a null root when the local record is gone', async () => {
  const roots: any[] = [];
  const f = fixture({
    remote: [{ id: 'w1', name: 'One', description: 'd' }],
    manifests: { summarize: (root: any) => (roots.push(root), { commands: { test: 'npm test' } }) },
  });
  const current: any = await handleBasicTool(f.context, 's1', 'workspace_current', {});
  assert.equal(current.id, 'w1');
  assert.equal(current.manifest.untrusted, true);
  assert.deepEqual(roots, [null]);
});
