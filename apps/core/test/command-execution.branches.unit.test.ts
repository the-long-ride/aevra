import assert from 'node:assert/strict';
import test from 'node:test';
import { CommandExecution } from '../src/operations/command-execution.js';
import { WorkspaceLockCoordinator } from '../src/policy/workspace-locks.js';

function harness(worker?: (input: any) => Promise<unknown>) {
  const calls: any[] = [];
  const sessions = {
    leaseForWorkspace: (_s: string, ws: string) => (ws === 'ws-known' ? { workspaceId: ws } : null),
    activeLease: (s: string) => (s === 'no-lease' ? null : { workspaceId: 'ws-active' }),
  };
  const subject = new CommandExecution(
    sessions as any,
    { capabilityRoots: (ws: string) => [{ id: `root-${ws}` }] } as any,
    {
      execute: (input: any) => (
        calls.push(input),
        worker ? worker(input) : Promise.resolve({ ok: true, value: 'done' })
      ),
    } as any,
    new WorkspaceLockCoordinator(),
    () => ({ effect: 'READ_ONLY', outputKeys: [] }),
  );
  return { subject, calls };
}

const cmd = { executable: 'git', args: ['status'] };

test('run reports missing leases for explicit and implicit workspaces', async () => {
  const { subject } = harness();
  await assert.rejects(
    () => subject.run('s', 'ws-unknown', cmd),
    (e: any) => e.code === 'WORKSPACE_ACCESS_REQUIRED',
  );
  await assert.rejects(
    () => subject.run('no-lease', cmd),
    (e: any) => e.code === 'SESSION_WORKSPACE_REQUIRED',
  );
  await assert.rejects(
    () => subject.run('s', { ...cmd, workspaceId: 'ws-unknown' } as any),
    (e: any) => e.code === 'WORKSPACE_ACCESS_REQUIRED',
  );
});

test('run fills defaults and resolves execution mode from settings', async () => {
  const { subject, calls } = harness();
  assert.deepEqual(await subject.run('s', cmd), { ok: true, value: 'done' });
  assert.deepEqual(calls[0].operation, {
    kind: 'command.run',
    command: { executable: 'git', args: ['status'], env: {}, cwdLogical: '/' },
    sandboxBackend: 'auto',
    cachePolicy: 'workspace',
    networkPolicy: { mode: 'deny-all', destinations: [], enforcement: 'backend' },
  });
  assert.equal(calls[0].executionMode, 'sandbox');
  assert.equal(calls[0].workspaceId, 'ws-active');
  subject.setSettingsResolver(() => ({ sandboxBackend: 'native', cachePolicy: 'shared' }));
  const policy = { mode: 'allow-list', destinations: ['x'], enforcement: 'backend' } as any;
  await subject.run('s', { ...cmd, env: { A: 'b' }, cwdLogical: '/src' }, undefined, policy);
  assert.equal(calls[1].executionMode, 'host');
  assert.equal(calls[1].operation.sandboxBackend, 'auto');
  assert.equal(calls[1].operation.cachePolicy, 'shared');
  assert.equal(calls[1].operation.networkPolicy, policy);
  assert.deepEqual(calls[1].operation.command.env, { A: 'b' });
  subject.setSettingsResolver(() => ({ sandboxBackend: 'docker' }));
  await subject.run('s', 'ws-known', cmd, 'host', policy);
  assert.equal(calls[2].executionMode, 'host');
  assert.equal(calls[2].operation.sandboxBackend, 'docker');
  assert.equal(calls[2].workspaceId, 'ws-known');
  assert.equal(calls[2].operation.networkPolicy, policy);
});

test('drain waits for in-flight runs, returns fast when idle, and times out', async () => {
  const resolvers: Array<(v: unknown) => void> = [];
  const { subject } = harness(() => new Promise((resolve) => resolvers.push(resolve)));
  await subject.drain('s');
  const first = subject.run('s', cmd);
  const second = subject.run('s', cmd);
  while (resolvers.length < 2) await new Promise((r) => setTimeout(r, 5));
  await assert.rejects(
    () => subject.drain('s', 5),
    (e: any) => e.code === 'WORKSPACE_SWITCH_TIMEOUT',
  );
  const drained = subject.drain('s', 5_000);
  for (const resolve of resolvers) resolve('late');
  await drained;
  assert.equal(await first, 'late');
  assert.equal(await second, 'late');
  await subject.drain('s');
});

test('a failing worker still releases the lock and clears the session set', async () => {
  const { subject } = harness(() => Promise.reject(new Error('worker words')));
  await assert.rejects(() => subject.run('s', cmd), /worker words/);
  await subject.drain('s', 5);
});
