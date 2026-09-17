import assert from 'node:assert/strict';
import test from 'node:test';
import type { UpstreamCatalog } from '../../../packages/mcp-upstream/src/protocol.js';
import type { SecretStore } from '../../../packages/secrets/src/store.js';
import { AevraDatabase } from '../../../packages/store/src/database.js';
import { UpstreamRegistryService } from '../src/mcp-upstream/upstream-registry-service.js';
import { UpstreamRepository } from '../src/mcp-upstream/upstream-repository.js';

const vault: SecretStore = { set: async () => {}, get: async () => null, delete: async () => {} };
const BENIGN: UpstreamCatalog = {
  tools: [{ name: 'echo', description: 'Echoes the text back', inputSchema: { type: 'object' } }],
  resources: [{ uri: 'repo:///readme', name: 'readme' }],
  prompts: [{ name: 'triage', description: 'Triages' }],
};
function harness() {
  const db = AevraDatabase.open(':memory:');
  let current = BENIGN;
  const service = new UpstreamRegistryService({
    repository: new UpstreamRepository(db.raw()),
    secrets: vault,
    worker: {
      connect: async () => {},
      catalog: async () => current,
      disconnect: async () => {},
      status: async () => ({
        upstreamId: 'mu_test',
        state: 'connected',
        server: null,
        failures: 0,
        retryAfter: null,
        lastError: null,
        listChangedAt: null,
      }),
      call: async () => ({}),
    },
    now: () => new Date('2026-09-15T00:00:00.000Z'),
  });
  return {
    db,
    service,
    serve: (catalog: UpstreamCatalog) => {
      current = catalog;
    },
  };
}
const input = {
  name: 'github',
  transport: 'http' as const,
  config: { url: 'https://a.test/mcp' },
  risk: 'MEDIUM' as const,
};

test('a changed description moves the server to needs-review and removes it from serving', async () => {
  const { db, service, serve } = harness();
  try {
    const record = await service.register(input);
    serve({
      ...BENIGN,
      tools: [
        { name: 'echo', description: 'Changed instructions', inputSchema: { type: 'object' } },
      ],
    });
    const result = await service.refresh(record.id);
    assert.equal(result.changed, true);
    assert.equal(result.record.state, 'needs-review');
    assert.deepEqual(service.serving(), []);
    assert.equal(result.record.catalogFingerprint, record.catalogFingerprint);
  } finally {
    db.close();
  }
});

test('a changed input schema, a new tool, and a new prompt each trigger review', async () => {
  for (const tampered of [
    {
      ...BENIGN,
      tools: [
        {
          name: 'echo',
          description: 'Echoes the text back',
          inputSchema: { type: 'object', properties: { exfiltrate: { type: 'string' } } },
        },
      ],
    },
    { ...BENIGN, tools: [...BENIGN.tools, { name: 'exec', description: 'Runs anything' }] },
    { ...BENIGN, prompts: [...BENIGN.prompts, { name: 'other' }] },
  ]) {
    const { db, service, serve } = harness();
    try {
      const record = await service.register(input);
      serve(tampered);
      const result = await service.refresh(record.id);
      assert.equal(result.changed, true);
      assert.equal(service.get(record.id)?.state, 'needs-review');
    } finally {
      db.close();
    }
  }
});

test('an unchanged catalog keeps serving', async () => {
  const { db, service, serve } = harness();
  try {
    const record = await service.register(input);
    serve({
      tools: [...BENIGN.tools],
      resources: [...BENIGN.resources],
      prompts: [...BENIGN.prompts],
    });
    assert.equal((await service.refresh(record.id)).changed, false);
    assert.equal(service.serving().length, 1);
  } finally {
    db.close();
  }
});

test('re-enabling does not bypass review; only acknowledgement clears it', async () => {
  const { db, service, serve } = harness();
  try {
    const record = await service.register(input);
    serve({ ...BENIGN, tools: [{ name: 'echo', description: 'Changed' }] });
    await service.refresh(record.id);
    service.setEnabled(record.id, false);
    service.setEnabled(record.id, true);
    assert.equal(service.get(record.id)?.state, 'needs-review');
    assert.deepEqual(service.serving(), []);
    service.acknowledge(record.id);
    assert.equal(service.serving().length, 1);
  } finally {
    db.close();
  }
});
