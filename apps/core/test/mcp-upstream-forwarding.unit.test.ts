import assert from 'node:assert/strict';
import test from 'node:test';
import type { UpstreamCatalog } from '../../../packages/mcp-upstream/src/protocol.js';
import type { McpUpstreamCall } from '../../../packages/protocol/src/mcp-upstream.js';
import type { SecretStore } from '../../../packages/secrets/src/store.js';
import { AevraDatabase } from '../../../packages/store/src/database.js';
import { UpstreamRegistryService } from '../src/mcp-upstream/upstream-registry-service.js';
import { UpstreamRepository } from '../src/mcp-upstream/upstream-repository.js';

const vault: SecretStore = { set: async () => {}, get: async () => null, delete: async () => {} };
const catalog: UpstreamCatalog = {
  tools: [{ name: 'create_issue', description: 'Opens an issue', inputSchema: { type: 'object' } }],
  resources: [{ uri: 'repo:///readme', name: 'readme' }],
  prompts: [{ name: 'triage', description: 'Triages' }],
};
function harness() {
  const db = AevraDatabase.open(':memory:');
  const forwarded: Array<{ upstreamId: string; call: McpUpstreamCall }> = [];
  const service = new UpstreamRegistryService({
    repository: new UpstreamRepository(db.raw()),
    secrets: vault,
    worker: {
      connect: async () => {},
      catalog: async () => catalog,
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
      call: async (upstreamId, call) => {
        forwarded.push({ upstreamId, call });
        return { content: [{ type: 'text', text: 'ok' }] };
      },
    },
    now: () => new Date('2026-09-15T00:00:00.000Z'),
  });
  return { db, service, forwarded };
}
async function registered() {
  const state = harness();
  const record = await state.service.register({
    name: 'github',
    transport: 'http',
    config: { url: 'https://mcp.example.test/mcp' },
    risk: 'MEDIUM',
  });
  return { ...state, record };
}

test('findByName resolves the operator-chosen name', async () => {
  const { service, record, db } = await registered();
  try {
    assert.equal(service.findByName('github')?.id, record.id);
    assert.equal(service.findByName('gitlab'), null);
  } finally {
    db.close();
  }
});
test('catalogByName returns the cached catalog', async () => {
  const { service, db } = await registered();
  try {
    assert.deepEqual(service.catalogByName('github'), catalog);
    assert.equal(service.catalogByName('gitlab'), null);
  } finally {
    db.close();
  }
});
test('callTool, readResource and getPrompt forward by row id with the right call shape', async () => {
  const { service, forwarded, record, db } = await registered();
  try {
    await service.callTool('github', 'create_issue', { title: 'bug' });
    await service.readResource('github', 'repo:///readme');
    await service.getPrompt('github', 'triage', { since: 'today' });
    assert.deepEqual(forwarded, [
      {
        upstreamId: record.id,
        call: { method: 'tool', name: 'create_issue', arguments: { title: 'bug' } },
      },
      { upstreamId: record.id, call: { method: 'resource', uri: 'repo:///readme' } },
      {
        upstreamId: record.id,
        call: { method: 'prompt', name: 'triage', arguments: { since: 'today' } },
      },
    ]);
  } finally {
    db.close();
  }
});
test('an unknown server name is refused rather than forwarded', async () => {
  const { service, forwarded, db } = await registered();
  try {
    await assert.rejects(service.callTool('gitlab', 'create_issue', {}), /MCP_UPSTREAM_UNKNOWN/);
    assert.deepEqual(forwarded, []);
  } finally {
    db.close();
  }
});
test('a needs-review server forwards nothing', async () => {
  const { service, forwarded, record, db } = await registered();
  try {
    service.markNeedsReview(record.id);
    await assert.rejects(
      service.callTool('github', 'create_issue', {}),
      /MCP_UPSTREAM_NEEDS_REVIEW/,
    );
    await assert.rejects(
      service.readResource('github', 'repo:///readme'),
      /MCP_UPSTREAM_NEEDS_REVIEW/,
    );
    await assert.rejects(service.getPrompt('github', 'triage'), /MCP_UPSTREAM_NEEDS_REVIEW/);
    assert.deepEqual(forwarded, []);
  } finally {
    db.close();
  }
});
test('a disabled server forwards nothing', async () => {
  const { service, forwarded, record, db } = await registered();
  try {
    service.setEnabled(record.id, false);
    await assert.rejects(service.callTool('github', 'create_issue', {}), /MCP_UPSTREAM_DISABLED/);
    assert.deepEqual(forwarded, []);
  } finally {
    db.close();
  }
});
test('a degraded server fails fast', async () => {
  const { service, forwarded, record, db } = await registered();
  try {
    service.markDegraded(record.id);
    await assert.rejects(service.callTool('github', 'create_issue', {}), /MCP_UPSTREAM_DEGRADED/);
    assert.deepEqual(forwarded, []);
  } finally {
    db.close();
  }
});
test('an unknown tool name is still forwarded because the upstream is authoritative', async () => {
  const { service, forwarded, db } = await registered();
  try {
    await service.callTool('github', 'not_in_the_cached_catalog', {});
    assert.equal(forwarded.length, 1);
    assert.equal(
      forwarded[0]!.call.method === 'tool' ? forwarded[0]!.call.name : '',
      'not_in_the_cached_catalog',
    );
  } finally {
    db.close();
  }
});
