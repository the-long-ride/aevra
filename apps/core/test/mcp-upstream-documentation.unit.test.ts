import assert from 'node:assert/strict';
import test from 'node:test';
import { publicUpstream } from '../src/admin/routes/mcp-upstream-input.js';
import type { UpstreamRecord } from '../src/mcp-upstream/upstream-records.js';

const record: UpstreamRecord = {
  id: 'u1',
  name: 'docs',
  transport: 'stdio',
  config: { command: 'node', args: [] },
  auth: {},
  enabled: false,
  state: 'needs-review',
  risk: 'HIGH',
  catalogFingerprint: null,
  catalog: {
    tools: [{ name: 'accepted', description: 'Accepted instructions' }],
    resources: [],
    prompts: [],
  },
  pendingCatalog: null,
  pendingCatalogDiff: null,
  createdAt: 'c',
  updatedAt: 'u',
};

test('projects instructions and input examples for all tools, including tools without annotations', () => {
  const inputSchema = {
    type: 'object',
    properties: { path: { type: 'string' } },
    examples: [{ path: '/example' }],
  };
  const projected = publicUpstream({
    ...record,
    catalog: {
      tools: [
        { name: 'read', description: 'Read a path. Example: read docs.', inputSchema },
        { name: 'wipe', annotations: { destructiveHint: true } },
      ],
      resources: [],
      prompts: [],
    },
  });
  assert.deepEqual(projected.tools, [
    { name: 'read', description: 'Read a path. Example: read docs.', inputSchema },
    { name: 'wipe', annotations: { destructiveHint: true } },
  ]);
  assert.equal(projected.documentationSource, 'accepted');
  assert.equal(projected.enabled, false);
  assert.deepEqual(projected.advisory, [{ tool: 'wipe', destructiveHint: true }]);
});

test('labels documentation from pending catalogs without accepting them', () => {
  const projected = publicUpstream({
    ...record,
    pendingCatalog: {
      tools: [{ name: 'pending', description: 'Changed instructions' }],
      resources: [],
      prompts: [],
    },
  });
  assert.equal(projected.documentationSource, 'pending');
  assert.equal(projected.tools[0].name, 'pending');
  assert.equal(projected.state, 'needs-review');
  assert.equal(record.pendingCatalog, null);
});

test('reports unavailable documentation when no catalog has been captured', () => {
  const projected = publicUpstream({ ...record, catalog: null });
  assert.deepEqual(projected.tools, []);
  assert.equal(projected.documentationSource, 'unavailable');
});
