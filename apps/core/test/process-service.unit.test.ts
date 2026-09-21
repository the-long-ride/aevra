import assert from 'node:assert/strict';
import test from 'node:test';
import { ProcessService } from '../src/processes/process-service.js';

function fixture() {
  const store = new Map<string, any>();
  const sessions: any = {
    activeLease: (sid: string) => (sid === 's1' ? { workspaceId: 'w1' } : null),
    leaseForWorkspace: (sid: string, wid: string) =>
      sid === 's1' && (wid === 'w1' || wid === 'w2') ? { workspaceId: wid } : null,
  };
  const workspaces: any = {
    getLocal: (id: string) => ({ id, name: `Workspace ${id}` }),
    capabilityRoots: (_id: string) => [],
  };
  const worker: any = {
    execute: async (req: any) => {
      if (req.operation.kind === 'fail') {
        return { ok: false, error: { message: 'failed', code: 'FAIL' } };
      }
      if (req.operation.kind === 'process.list') {
        return { ok: true, value: [{ processId: 'p1', state: 'running', pid: 1234 }] };
      }
      return {
        ok: true,
        value: {
          processId: req.operation.processId ?? 'p1',
          pid: 1234,
          startedAt: new Date().toISOString(),
          state: 'running',
          logPath: '/tmp/log',
        },
      };
    },
  };
  const repo: any = {
    put: (r: any) => store.set(r.id, r),
    get: (id: string) => {
      const row = store.get(id);
      if (!row) return null;
      return {
        ...row,
        workspace_id: row.workspaceId ?? row.workspace_id,
        command_json:
          typeof row.command === 'object' ? JSON.stringify(row.command) : row.command_json,
        execution_mode: row.executionMode ?? 'host',
      };
    },
    list: (wid?: string) => {
      const all = Array.from(store.values());
      const filtered = wid ? all.filter((r) => (r.workspaceId ?? r.workspace_id) === wid) : all;
      return filtered.map((r) => ({
        ...r,
        workspace_id: r.workspaceId ?? r.workspace_id,
        command_json: typeof r.command === 'object' ? JSON.stringify(r.command) : r.command_json,
      }));
    },
    updateStatus: (s: any) => {
      const row = store.get(s.processId);
      if (row) Object.assign(row, s);
    },
    delete: (id: string) => store.delete(id),
  };

  const service = new ProcessService(sessions, workspaces, worker, repo);
  return { service, store, sessions, worker, repo };
}

test('ProcessService: start with 2-arg and 5-arg signatures', async () => {
  const { service } = fixture();

  // 5-arg signature: sessionId, workspaceId, command, lifecycle, name
  const p1 = await service.start(
    's1',
    'w1',
    { executable: 'node', args: ['server.js'], env: {} },
    'keep-alive',
    'api-server',
  );
  assert.equal(p1.processId, 'p1');
  assert.equal(p1.name, 'api-server');

  // 2-arg signature: sessionId, command
  const p2 = await service.start('s1', {
    executable: 'vite',
    args: [],
    env: {},
    workspaceId: 'w1',
  } as any);
  assert.ok(p2.processId);

  // Missing lease rejects
  await assert.rejects(
    service.start('invalid-session', 'w1', { executable: 'echo', args: [], env: {} }),
    /Workspace access required/,
  );
});

test('ProcessService: listLocal and localAction lifecycle', async () => {
  const { service, repo } = fixture();

  repo.put({
    id: 'p_loc',
    name: 'test-proc',
    workspaceId: 'w1',
    lifecycle: 'stop-with-aevra',
    ownership: 'owned',
    command: { executable: 'node', args: [], env: {} },
  });

  const localList = service.listLocal();
  assert.equal(localList.length, 1);
  assert.equal(localList[0].workspace_name, 'Workspace w1');

  // Action: stop
  const stopRes = await service.localAction('p_loc', 'stop');
  assert.ok(stopRes);

  // Action: restart
  const restartRes = await service.localAction('p_loc', 'restart');
  assert.ok(restartRes);

  // Action: forget
  const forgetRes = await service.localAction('p_loc', 'forget');
  assert.equal((forgetRes as any).forgotten, true);

  // Error on missing
  await assert.rejects(service.localAction('missing', 'stop'), /process not found/);

  // Error on detached-uncertain
  repo.put({
    id: 'p_uncertain',
    workspaceId: 'w1',
    ownership: 'detached-uncertain',
  });
  await assert.rejects(
    service.localAction('p_uncertain', 'stop'),
    /Detached process ownership is uncertain/,
  );
});

test('ProcessService: list, status, wait, and command operations', async () => {
  const { service, repo } = fixture();

  repo.put({
    id: 'p1',
    name: 'proc1',
    workspaceId: 'w1',
    lifecycle: 'stop-with-aevra',
    ownership: 'owned',
    command: { executable: 'node' },
    state: 'running',
    helper_pid: 4321,
    created_at: new Date().toISOString(),
  });

  // list
  const list = await service.list('s1', 'w1');
  assert.equal(list.length, 1);
  assert.equal(list[0].processId, 'p1');

  // status with processId only
  const st1 = await service.status('s1', 'p1');
  assert.equal((st1 as any).value?.processId, 'p1');

  // status with workspaceId and processId
  const st2 = await service.status('s1', 'w1', 'p1');
  assert.equal((st2 as any).value?.processId, 'p1');

  // wait with timeout
  const w1 = await service.wait('s1', 'p1', 5000);
  assert.ok(w1);

  // wait with workspaceId, processId, and timeout
  const w2 = await service.wait('s1', 'w1', 'p1', 5000);
  assert.ok(w2);

  // command: process.logs
  const logs = await service.command('s1', 'process.logs', 'p1', 'cur1');
  assert.ok(logs);

  // command: process.restart with workspaceId
  const restarted = await service.command('s1', 'w1', 'process.restart', 'p1');
  assert.ok(restarted);

  // explicit workspace ownership is enforced for every process operation
  await assert.rejects(service.status('s1', 'w2', 'p1'), /process not in active workspace/);
  await assert.rejects(service.wait('s1', 'w2', 'p1', 5000), /process not in active workspace/);
  await assert.rejects(
    service.command('s1', 'w2', 'process.logs', 'p1'),
    /process not in active workspace/,
  );
  await assert.rejects(
    service.command('s1', 'w2', 'process.stop', 'p1'),
    /process not in active workspace/,
  );
  await assert.rejects(
    service.command('s1', 'w2', 'process.restart', 'p1'),
    /process not in active workspace/,
  );

  // process not found error
  await assert.rejects(service.status('s1', 'missing'), /process not found/);
});
