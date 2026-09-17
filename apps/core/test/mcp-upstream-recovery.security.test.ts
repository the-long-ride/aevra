import assert from 'node:assert/strict';
import test from 'node:test';
import { AevraDatabase } from '../../../packages/store/src/database.js';
import { UpstreamRegistryService } from '../src/mcp-upstream/upstream-registry-service.js';
import { UpstreamRepository } from '../src/mcp-upstream/upstream-repository.js';
import { UpstreamSessionRegistry } from '../../worker/src/mcp-upstream-runtime.js';
import { FakeUpstreamClient } from '../../worker/test/fake-upstream-client.js';

for (const changed of [false, true]) {
  for (const method of ['tool', 'resource', 'prompt'] as const) {
    test(`${method} recovery validates ${changed ? 'changed' : 'unchanged'} catalog after a status/dispatch race`, async () => {
      let now = 0;
      let created = 0;
      let forwarded = 0;
      let statusReads = 0;
      const approved = {
        tools: [{ name: 'echo', description: 'approved' }],
        resources: [],
        prompts: [],
      };
      const first = new FakeUpstreamClient({ catalog: approved });
      const second = new FakeUpstreamClient({
        catalog: changed
          ? { ...approved, tools: [{ name: 'echo', description: 'changed' }] }
          : approved,
        onCall: () => {
          forwarded += 1;
          return { ok: true };
        },
      });
      const sessions = new UpstreamSessionRegistry({
        createClient: () => (++created === 1 ? first : second),
        now: () => now,
      });
      const db = AevraDatabase.open(':memory:');
      const service = new UpstreamRegistryService({
        repository: new UpstreamRepository(db.raw()),
        secrets: { get: async () => null, set: async () => {}, delete: async () => {} },
        worker: {
          connect: async (id, config) => {
            await sessions.connect(id, config);
          },
          catalog: (id) => sessions.catalog(id),
          disconnect: (id) => sessions.disconnect(id),
          call: (id, call) => sessions.call(id, call),
          status: async (id) => {
            const snapshot = sessions.status(id)[0] ?? null;
            if (++statusReads === 2) {
              first.emitClosed();
              now += 2_000;
            }
            return snapshot;
          },
        },
      });
      const invoke = () =>
        method === 'tool'
          ? service.callTool('demo', 'echo', {})
          : method === 'resource'
            ? service.readResource('demo', 'file:///a')
            : service.getPrompt('demo', 'greet');
      try {
        const row = await service.register({
          name: 'demo',
          transport: 'http',
          config: { url: 'http://localhost/mcp' },
          risk: 'HIGH',
        });
        await assert.rejects(invoke(), { code: 'UPSTREAM_DIED' });
        assert.equal(created, 1);
        assert.equal(forwarded, 0);
        if (changed) {
          await assert.rejects(invoke(), /MCP_UPSTREAM_NEEDS_REVIEW/);
          assert.equal(service.get(row.id)?.state, 'needs-review');
          assert.equal(forwarded, 0);
          service.acknowledge(row.id);
        }
        assert.deepEqual(await invoke(), { ok: true });
        assert.equal(forwarded, 1);
        assert.equal(created, 2);
      } finally {
        await sessions.disconnect();
        db.close();
      }
    });
  }
}
