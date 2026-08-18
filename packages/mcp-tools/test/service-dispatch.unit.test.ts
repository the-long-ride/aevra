import assert from 'node:assert/strict';
import test from 'node:test';
import { McpToolService } from '../src/service.js';

function service(options: { known?: boolean } = {}) {
  const records: Array<[string, number]> = [];
  const lease = {
    workspaceId: 'w1',
    capabilities: ['files.read'],
  };
  const sessions = {
    get: () =>
      options.known === false
        ? null
        : { id: 's1', actor: 'oauth:user', subject: 'user' },
    touch() {},
    activeLease: () => lease,
  } as any;
  const workspaces = {
    listRemote: () => [{ id: 'w1', name: 'Aevra', description: '' }],
    getLocal: () => ({
      id: 'w1',
      name: 'Aevra',
      description: '',
      hostRoot: '/x',
    }),
  } as any;
  const worker = {
    execute: async () => ({ ok: true, value: {} }),
  } as any;
  const reads = { put() {} } as any;
  const instance = new McpToolService(
    sessions,
    workspaces,
    worker,
    reads,
    undefined,
    {
      permissions: {
        summary: () => ({
          effectiveCapabilities: ['files.read', 'files.search'],
          commandMatchers: ['git:status'],
        }),
      } as any,
      metrics: {
        record: (name, ms) => records.push([name, ms]),
      },
    },
  );
  return { instance, records };
}

test('unknown sessions remain unauthorized', async () => {
  const { instance, records } = service({ known: false });
  await assert.rejects(
    () => instance.call('missing', 'aevra_status'),
    (error: any) => {
      assert.equal(error.code, 'UNAUTHORIZED');
      return true;
    },
  );
  assert.equal(records.length, 1);
  assert.equal(records[0]![0], 'aevra_status');
});

test('status dispatch preserves effective capability summary', async () => {
  const { instance, records } = service();
  const result = await instance.call('s1', 'aevra_status');
  assert.deepEqual(result.effectiveCapabilities, [
    'files.read',
    'files.search',
  ]);
  assert.deepEqual(result.commandMatchers, ['git:status']);
  assert.equal(result.workspace.id, 'w1');
  assert.equal(records.length, 1);
});
