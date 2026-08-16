import assert from 'node:assert/strict';
import test from 'node:test';
import { OperationService } from '../src/operations/operation-service.js';

function fixture() {
  const calls: any[] = [];
  const sessions = {
    activeLease: () => ({ workspaceId: 'ws-1' }),
  } as any;
  const workspaces = {
    capabilityRoots: () => [],
  } as any;
  const worker = {
    execute: async (input: any) => {
      calls.push(input);
      return { ok: true, value: { exitCode: 0 } };
    },
  } as any;
  const locks = {
    acquire: async () => ({ release() {} }),
  } as any;
  const service = new OperationService(
    sessions,
    workspaces,
    worker,
    {} as any,
    {} as any,
    {} as any,
    locks,
  );
  service.setExecutionSettingsResolver(() => ({
    sandboxBackend: 'native',
    cachePolicy: 'workspace',
  }));
  return { calls, service };
}

test('native execution setting makes unspecified commands use host execution', async () => {
  const { calls, service } = fixture();
  await service.runCommand('session-1', { executable: 'git', args: ['status'] });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].executionMode, 'host');
  assert.equal(calls[0].operation.sandboxBackend, 'auto');
});

test('explicit sandbox execution keeps sandbox mode and maps native backend to auto', async () => {
  const { calls, service } = fixture();
  await service.runCommand('session-1', { executable: 'git', args: ['status'] }, 'sandbox');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].executionMode, 'sandbox');
  assert.equal(calls[0].operation.sandboxBackend, 'auto');
});
