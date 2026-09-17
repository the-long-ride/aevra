import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { AevraDatabase } from '../../../packages/store/src/database.js';
import { createMcpUpstreams } from '../src/runtime-support.js';

test('createMcpUpstreams returns the registry methods used by the admin surface', () => {
  const db = AevraDatabase.open(':memory:');
  try {
    const service = createMcpUpstreams(
      db,
      {
        async execute() {
          return { ok: false, error: { code: 'EXECUTOR_UNAVAILABLE', message: 'offline' } };
        },
      },
      { set: async () => {}, get: async () => null, delete: async () => {} },
    );
    for (const method of ['list', 'create', 'update', 'remove', 'test', 'acknowledge']) {
      assert.equal(typeof (service as any)[method], 'function', `${method} must exist`);
    }
  } finally {
    db.close();
  }
});

test('runtime hands the registry to the admin API context', () => {
  const source = readFileSync('apps/core/src/runtime.ts', 'utf8');
  assert.match(source, /createMcpUpstreams\(/);
  assert.match(source, /dataServices = await createRuntimeDataServices\(config, db\)/);
  assert.match(
    source,
    /const mcpUpstreams = createMcpUpstreams\(db, workerGateway, dataServices\.secretStore\)/,
  );
  assert.match(source, /upstreams: mcpUpstreams/);
  assert.match(source, /mcpUpstreams,/);
});

test('the MCP servers chapter is published in the manual and guide', async () => {
  const { GUIDE_CHAPTERS } = await import('../src/admin/routes/route-state.js');
  const chapter = GUIDE_CHAPTERS.find((entry) => entry.slug === 'mcp-upstreams');
  assert.ok(chapter);
  assert.equal(chapter!.file, '20-mcp-upstreams.md');
  const page = readFileSync(`docs/user-manual/${chapter!.file}`, 'utf8');
  assert.match(page, /secret reference/i);
  assert.match(page, /advisory/i);
  assert.match(readFileSync('docs/user-manual/README.md', 'utf8'), /20-mcp-upstreams\.md/);
});
