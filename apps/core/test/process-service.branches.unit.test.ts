import assert from 'node:assert/strict';
import test from 'node:test';
import { AevraDatabase } from '../../../packages/store/src/database.js';
import { ProcessRepository } from '../../../packages/store/src/processes.js';
import { ProcessService } from '../src/processes/process-service.js';

function status(overrides: Record<string, unknown> = {}) {
  return {
    processId: 'p1',
    pid: 100,
    startedAt: '2026-09-01T00:00:00.000Z',
    lifecycle: 'stop-with-aevra',
    state: 'running',
    exitCode: null,
    signal: null,
    finishedAt: null,
    logPath: 'hidden-log-path',
    resultPath: 'hidden-result-path',
    ...overrides,
  };
}

function fixture(opts: { leaseFn?: boolean } = {}) {
  const db = AevraDatabase.open(':memory:');
  const repo = new ProcessRepository(db.raw());
  const calls: any[] = [];
  let reply: (req: any) => any = (req) => ({ ok: true, value: status({ processId: req.operation.processId ?? 'p1' }) });
  const sessions: any = { activeLease: (sid: string) => (sid === 's1' ? { workspaceId: 'w1' } : null) };
  if (opts.leaseFn !== false) {
    sessions.leaseForWorkspace = (sid: string, wid: string) => (sid === 's1' && wid === 'w1' ? { workspaceId: wid } : null);
  }
  const workspaces: any = {
    getLocal: (id: string) => (id === 'w1' ? { name: 'Main' } : null),
    capabilityRoots: () => [],
  };
  const worker: any = {
    execute: async (req: any) => {
      calls.push(req);
      return reply(req);
    },
  };
  const service = new ProcessService(sessions, workspaces, worker, repo as any);
  return { db, repo, service, calls, setReply: (fn: (req: any) => any) => (reply = fn) };
}

const command = { executable: 'node', args: ['server.js'] } as any;
const accessRequired = (e: any) => e.code === 'WORKSPACE_ACCESS_REQUIRED';

test('start surfaces worker errors and strips local-only paths from the status', async () => {
  const f = fixture();
  f.setReply(() => ({ ok: false, error: { code: 'SPAWN_FAILED', message: 'no such executable' } }));
  await assert.rejects(() => f.service.start('s1', 'w1', command), (e: any) => e.code === 'SPAWN_FAILED' && e.message === 'no such executable');
  assert.equal(f.repo.list().length, 0);
  f.setReply(() => ({ ok: true, value: status({ marker: 'custom-marker' }) }));
  const started: any = await f.service.start('s1', 'w1', command, undefined, '   ');
  assert.equal(started.name, undefined, 'blank names are dropped');
  assert.equal(started.logPath, undefined);
  assert.equal(started.resultPath, undefined);
  assert.equal(f.calls.at(-1).operation.lifecycle, 'stop-with-aevra');
  assert.equal(f.repo.get('p1').marker, 'custom-marker');
  f.db.close();
});

test('start without a lease helper uses the active lease and checks its workspace', async () => {
  const f = fixture({ leaseFn: false });
  await assert.rejects(() => f.service.start('s1', 'w2', command), accessRequired);
  await assert.rejects(() => f.service.start('s9', command), accessRequired);
  const started: any = await f.service.start('s1', command, 'keep-running', 'named');
  assert.equal(started.name, 'named');
  assert.equal(f.repo.get('p1').lifecycle, 'keep-running');
  f.db.close();
});

test('listLocal resolves workspace names and parses stored commands', async () => {
  const f = fixture();
  f.repo.put({ id: 'a', workspaceId: 'w1', lifecycle: 'stop-with-aevra', ownership: 'owned', command, executionMode: 'host' });
  f.repo.put({ id: 'b', workspaceId: 'gone', lifecycle: 'stop-with-aevra', ownership: 'owned', command, executionMode: 'host' });
  const rows = f.service.listLocal().sort((x: any, y: any) => x.id.localeCompare(y.id));
  assert.deepEqual(rows.map((r: any) => [r.workspace_name, r.command.executable]), [['Main', 'node'], ['gone', 'node']]);
  f.db.close();
});

test('localAction refuses uncertain ownership and propagates worker failures', async () => {
  const f = fixture();
  await assert.rejects(() => f.service.localAction('missing', 'stop'), /process not found/);
  f.repo.put({ id: 'p1', workspaceId: 'w1', lifecycle: 'keep-running', ownership: 'detached-uncertain', command, executionMode: 'host' });
  await assert.rejects(() => f.service.localAction('p1', 'restart'), (e: any) => e.code === 'PROCESS_OWNERSHIP_UNCERTAIN');
  f.repo.put({ id: 'p2', workspaceId: 'w1', lifecycle: 'keep-running', ownership: 'owned', command, executionMode: 'host' });
  f.setReply(() => ({ ok: false, error: { code: 'GONE', message: 'already exited' } }));
  await assert.rejects(() => f.service.localAction('p2', 'restart'), (e: any) => e.code === 'GONE');
  assert.equal(f.calls.at(-1).operation.kind, 'process.restart');
  assert.deepEqual(await f.service.localAction('p2', 'forget'), { forgotten: true });
  assert.equal(f.repo.get('p2'), undefined);
  f.db.close();
});

test('list requires a lease and tolerates worker failures while projecting records', async () => {
  const f = fixture();
  await assert.rejects(() => f.service.list('s9', 'w1'), accessRequired);
  f.repo.put({ id: 'p1', name: 'api', workspaceId: 'w1', lifecycle: 'stop-with-aevra', ownership: 'owned', command, executionMode: 'host', marker: 'm' });
  f.setReply(() => ({ ok: false, error: { code: 'X', message: 'x' } }));
  const [record]: any[] = await f.service.list('s1', 'w1');
  assert.equal(record.name, 'api');
  assert.equal(record.pid, 0);
  assert.equal(record.state, 'running');
  assert.equal(record.durationMs, null);
  assert.equal(record.marker, 'm');
  assert.equal(record.startedAt, f.repo.get('p1').created_at, 'falls back to creation time');
  f.setReply(() => ({ ok: true, value: 'not-a-list' }));
  assert.equal((await f.service.list('s1', 'w1')).length, 1);
  f.setReply(() => ({ ok: true, value: [status({ state: 'exited', exitCode: 0, finishedAt: '2026-09-01T00:00:05.000Z' }), status({ processId: 'unknown' })] }));
  f.repo.put({ id: 'p1', workspaceId: 'w1', lifecycle: 'stop-with-aevra', ownership: 'owned', command, executionMode: 'host', helperPid: 100, helperStartedAt: '2026-09-01T00:00:00.000Z' });
  const [done]: any[] = await f.service.list('s1', 'w1');
  assert.equal(done.state, 'exited');
  assert.equal(done.durationMs, 5000);
  assert.equal(done.name, undefined);
  assert.equal(done.marker, undefined);
  assert.equal(f.repo.get('unknown'), undefined, 'unknown worker processes are not adopted');
  f.db.close();
});

test('status and wait check workspace, lease, and worker result before reconciling', async () => {
  const f = fixture();
  f.repo.put({ id: 'p1', name: 'api', workspaceId: 'w1', lifecycle: 'stop-with-aevra', ownership: 'owned', command, executionMode: 'host' });
  f.repo.put({ id: 'p3', workspaceId: 'w3', lifecycle: 'stop-with-aevra', ownership: 'owned', command, executionMode: 'host' });
  await assert.rejects(() => f.service.status('s1', 'missing'), /process not found/);
  await assert.rejects(() => f.service.status('s1', 'w2', 'p1'), /not in active workspace/);
  await assert.rejects(() => f.service.status('s1', 'p3'), accessRequired);
  f.setReply(() => ({ ok: false, error: { code: 'X', message: 'x' } }));
  assert.equal((await f.service.status('s1', 'w1', 'p1')).ok, false);
  f.setReply((req) => ({ ok: true, value: status({ processId: req.operation.processId, state: 'exited', exitCode: 2, finishedAt: '2026-09-01T00:00:01.000Z' }) }));
  const waited: any = await f.service.wait('s1', 'p1', 250);
  assert.equal(f.calls.at(-1).operation.timeoutMs, 250);
  assert.equal(waited.value.name, 'api');
  assert.equal(waited.value.logPath, undefined);
  assert.equal(f.repo.get('p1').exit_code, 2);
  const scoped: any = await f.service.wait('s1', 'w1', 'p1', 10);
  assert.equal(f.calls.at(-1).operation.timeoutMs, 10);
  assert.equal(scoped.ok, true);
  f.db.close();
});

test('command validates workspace and lease, reconciles logs, and re-registers restarts', async () => {
  const f = fixture();
  f.repo.put({ id: 'p1', workspaceId: 'w1', lifecycle: 'keep-running', ownership: 'owned', command, executionMode: 'host' });
  f.repo.put({ id: 'p3', workspaceId: 'w3', lifecycle: 'stop-with-aevra', ownership: 'owned', command, executionMode: 'host' });
  await assert.rejects(() => f.service.command('s1', 'process.logs', 'missing'), /process not found/);
  await assert.rejects(() => f.service.command('s1', 'w2', 'process.logs', 'p1'), /not in active workspace/);
  await assert.rejects(() => f.service.command('s1', 'process.stop', 'p3'), accessRequired);

  f.setReply(() => ({ ok: true, value: { lines: ['hello'], cursor: 'c2' } }));
  const logs: any = await f.service.command('s1', 'w1', 'process.logs', 'p1', 'c1');
  assert.deepEqual(f.calls.at(-1).operation, { kind: 'process.logs', processId: 'p1', cursor: 'c1' });
  assert.deepEqual(logs.value, { lines: ['hello'], cursor: 'c2' });
  f.setReply(() => ({ ok: true, value: null }));
  await f.service.command('s1', 'process.logs', 'p1', 'c3');
  assert.equal(f.calls.at(-1).operation.cursor, 'c3');
  f.setReply(() => ({ ok: true, value: status({ processId: 'p1', state: 'exited', exitCode: 0, signal: null, finishedAt: '2026-09-01T00:00:02.000Z' }) }));
  await f.service.command('s1', 'process.logs', 'p1');
  assert.equal(f.repo.get('p1').state, 'exited');

  f.setReply(() => ({ ok: true, value: status({ processId: 'p1-next', pid: 200 }) }));
  const restarted: any = await f.service.command('s1', 'process.restart', 'p1');
  assert.equal(restarted.value.processId, 'p1-next');
  assert.equal(restarted.value.name, undefined);
  assert.equal(restarted.value.logPath, undefined);
  assert.equal(f.repo.get('p1'), undefined);
  const next = f.repo.get('p1-next');
  assert.equal(next.lifecycle, 'keep-running');
  assert.equal(next.marker, 'worker-owned');
  assert.deepEqual(JSON.parse(next.command_json), command);

  f.setReply(() => ({ ok: false, error: { code: 'X', message: 'x' } }));
  assert.equal(((await f.service.command('s1', 'process.stop', 'p1-next')) as any).ok, false);
  f.db.close();
});
