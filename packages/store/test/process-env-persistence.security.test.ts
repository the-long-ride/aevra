import assert from 'node:assert/strict';
import test from 'node:test';
import { AevraDatabase } from '../src/database.js';
import { ProcessRepository } from '../src/processes.js';

test('managed process persistence keeps env names but never raw inline values', () => {
  const db = AevraDatabase.open(':memory:');
  const repo = new ProcessRepository(db.raw());
  const secret = 'synthetic-process-env-secret-6EAF';
  repo.put({
    id: 'proc_secret',
    workspaceId: 'ws_1',
    lifecycle: 'stop-with-aevra',
    ownership: 'owned',
    helperPid: 42,
    helperStartedAt: new Date().toISOString(),
    marker: 'worker-owned',
    command: {
      executable: process.execPath,
      args: ['-e', 'process.exit(0)'],
      env: { API_TOKEN: secret, NORMAL_FLAG: 'visible-but-inline' },
    },
    executionMode: 'host',
    state: 'running',
  });

  const row = repo.get('proc_secret');
  assert.equal(String(row.command_json).includes(secret), false);
  assert.equal(String(row.command_json).includes('visible-but-inline'), false);
  const command = JSON.parse(row.command_json);
  assert.deepEqual(Object.keys(command.env).sort(), ['API_TOKEN', 'NORMAL_FLAG']);
  assert.equal(command.env.API_TOKEN, '[REDACTED]');
  assert.equal(command.env.NORMAL_FLAG, '[REDACTED]');
  db.close();
});
