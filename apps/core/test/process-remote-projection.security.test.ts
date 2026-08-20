import assert from 'node:assert/strict';
import test from 'node:test';
import { ProcessService } from '../src/processes/process-service.js';

function fixture() {
  const stored: any[] = [];
  const updated: any[] = [];
  const records: any[] = [];
  const sessions = {
    activeLease: () => ({ workspaceId: 'ws_1' }),
  } as any;
  const workspaces = { capabilityRoots: () => [] } as any;
  const worker = {
    async execute(input: any) {
      if (input.operation.kind === 'process.start') {
        return {
          ok: true,
          value: {
            processId: 'proc_1',
            pid: 42,
            startedAt: '2026-08-20T00:00:00.000Z',
            lifecycle: 'stop-with-aevra',
            state: 'running',
            exitCode: null,
            signal: null,
            finishedAt: null,
            durationMs: null,
            logPath: '/host/private/process.log',
            resultPath: '/host/private/process.result.json',
          },
        };
      }
      if (input.operation.kind === 'process.status') {
        return {
          ok: true,
          value: {
            processId: 'proc_1',
            pid: 42,
            startedAt: '2026-08-20T00:00:00.000Z',
            lifecycle: 'stop-with-aevra',
            state: 'completed',
            exitCode: 0,
            signal: null,
            finishedAt: '2026-08-20T00:00:01.000Z',
            durationMs: 1000,
            logPath: '/host/private/process.log',
            resultPath: '/host/private/process.result.json',
          },
        };
      }
      return { ok: true, value: [] };
    },
  } as any;
  const repo = {
    put(value: any) {
      stored.push(value);
      records.splice(0, records.length, {
        id: value.id,
        workspace_id: value.workspaceId,
        lifecycle: value.lifecycle,
        ownership: value.ownership,
        helper_pid: value.helperPid,
        helper_started_at: value.helperStartedAt,
        marker: value.marker,
        command_json: JSON.stringify(value.command),
        execution_mode: value.executionMode,
        log_path: value.logPath,
        state: value.state,
        exit_code: value.exitCode,
        signal: value.signal,
        finished_at: value.finishedAt,
      });
    },
    list() {
      return records;
    },
    get() {
      return records[0] ?? null;
    },
    updateStatus(value: any) {
      updated.push(value);
    },
    delete() {},
  } as any;
  return { service: new ProcessService(sessions, workspaces, worker, repo), stored, updated, records };
}

function assertRemoteSafe(value: any) {
  assert.equal('logPath' in value, false);
  assert.equal('resultPath' in value, false);
  assert.equal(JSON.stringify(value).includes('/host/private'), false);
}

test('remote process start omits local log/result paths but persistence keeps local log path', async () => {
  const f = fixture();
  const value = await f.service.start(
    'ses_1',
    { executable: process.execPath, args: [], env: {} },
    'stop-with-aevra',
  );
  assertRemoteSafe(value);
  assert.equal(f.stored[0]?.logPath, '/host/private/process.log');
});

test('remote process status and list omit local paths', async () => {
  const f = fixture();
  await f.service.start(
    'ses_1',
    { executable: process.execPath, args: [], env: {} },
    'stop-with-aevra',
  );
  const status: any = await f.service.status('ses_1', 'proc_1');
  assert.equal(status.ok, true);
  assertRemoteSafe(status.value);
  const list = await f.service.list('ses_1');
  assert.equal(list.length, 1);
  assertRemoteSafe(list[0]);
});
