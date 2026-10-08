import assert from 'node:assert/strict';
import test from 'node:test';
import { advertisedGroupTokens, advertisedToolDefinitions } from '../src/registry-advertised.js';
import { toolDefinitions } from '../src/registry.js';
import { TOOL_GROUPS, toolGroupOf } from '../src/tool-groups.js';

test('default tools/list stays within the size budget', () => {
  const size = JSON.stringify(advertisedToolDefinitions()).length;
  assert.ok(size <= 54_000, `advertised tools/list is ${size} chars, budget 54000`);
});

test('advertised definitions list the same tools as the full registry', () => {
  assert.deepEqual(
    advertisedToolDefinitions().map((t) => t.name),
    toolDefinitions().map((t) => t.name),
  );
});

test('compaction drops default-valued and legacy noise but keeps required inputs', () => {
  const text = JSON.stringify(advertisedToolDefinitions());
  assert.equal(text.includes('Deprecated compatibility field'), false);
  assert.equal(text.includes('"readOnlyHint":false'), false);
  assert.equal(text.includes('"idempotentHint":false'), false);
  assert.equal(text.includes('"outputSchema":{"type":"object"}'), false);
  const read = advertisedToolDefinitions().find((t) => t.name === 'file_read_many') as any;
  assert.ok(read.inputSchema.required?.length > 0);
});

test('MCP hints whose default is true are never dropped', () => {
  const push = advertisedToolDefinitions().find((t) => t.name === 'git_push') as any;
  assert.equal(push.annotations.destructiveHint, true);
  const status = advertisedToolDefinitions().find((t) => t.name === 'git_status') as any;
  assert.equal(status.annotations.destructiveHint, false);
  assert.equal(status.annotations.openWorldHint, false);
  assert.equal(status.annotations.readOnlyHint, true);
});

test('workspace properties use the short descriptions', () => {
  const text = JSON.stringify(advertisedToolDefinitions());
  assert.equal(text.includes('Workspace name for this operation.'), false);
  assert.equal(text.includes('Workspace ID for this batch.'), false);
});

test('filtering by groups removes whole groups and keeps core', () => {
  const names = advertisedToolDefinitions(['files']).map((t) => t.name);
  assert.ok(names.includes('file_read_many'));
  assert.ok(names.includes('approval_wait'));
  assert.ok(
    !names.some(
      (n) => n.startsWith('browser_') || n.startsWith('desktop_') || n.startsWith('git_'),
    ),
  );
  assert.ok(advertisedToolDefinitions([]).length < advertisedToolDefinitions().length / 3);
});

test('the compact list is memoised', () => {
  assert.equal(advertisedToolDefinitions()[0], advertisedToolDefinitions()[0]);
});

test('group token estimates cover every group and add up near the total', () => {
  const tokens = advertisedGroupTokens();
  for (const group of ['core', ...TOOL_GROUPS] as const) assert.ok(group in tokens, group);
  assert.equal(tokens.upstream, 0);
  assert.ok(tokens.browser > tokens.git);
  const sum = Object.values(tokens).reduce((a, b) => a + b, 0);
  const total = Math.ceil(JSON.stringify(advertisedToolDefinitions()).length / 4);
  assert.ok(Math.abs(sum - total) / total < 0.1);
});

test('toolGroupOf puts every advertised tool in exactly one known group', () => {
  for (const tool of advertisedToolDefinitions()) {
    const group = toolGroupOf(tool.name);
    assert.ok(group === 'core' || (TOOL_GROUPS as readonly string[]).includes(group), tool.name);
  }
});
