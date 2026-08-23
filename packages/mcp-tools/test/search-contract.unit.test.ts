import assert from 'node:assert/strict';
import test from 'node:test';
import { toolDefinitions } from '../src/registry.js';

test('registry exposes a read-only parallel search tool', () => {
  const search = toolDefinitions().find((tool) => tool.name === ('search' as any));
  assert.ok(search, 'search tool must be registered');
  assert.equal(search.annotations.readOnlyHint, true);
  assert.equal(search.annotations.idempotentHint, true);
  assert.deepEqual((search.inputSchema as any).required, ['queries']);
  const querySchema = (search.inputSchema as any).properties.queries.items;
  assert.deepEqual(querySchema.properties.mode.enum, ['text', 'regex', 'files']);
});
