import assert from 'node:assert/strict';
import test from 'node:test';
import { AevraDatabase } from '../../../packages/store/src/database.js';
import { SettingsRepository } from '../../../packages/store/src/settings.js';
import { buildAdminApiContext, createCoreToolService } from '../src/admin/admin-api-context.js';
import { createRuntimeUsage } from '../src/usage/runtime-usage.js';

test('createRuntimeUsage wires one notes service into admin, MCP ingress and tools', async () => {
  const db = AevraDatabase.open(':memory:');
  const usage = createRuntimeUsage(db.raw(), new SettingsRepository(db.raw()));
  assert.equal(usage.admin.connectorNotes, usage.notes);
  assert.equal(usage.tools.connectorNotes, usage.notes);
  assert.equal(usage.mcp.connectNotice('connector:alpha'), null);
  usage.notes.create('connector:alpha', { text: 'plain test phrase' });
  assert.equal(usage.mcp.connectNotice('connector:alpha'), null);
  usage.notes.create('connector:alpha', { text: 'plain test phrase', readOnConnect: true });
  assert.match(usage.mcp.connectNotice('connector:alpha') ?? '', /1 note\(s\)/);
  const admin = buildAdminApiContext({ exposureWiring: {}, ...usage.admin } as any);
  assert.equal(admin.connectorNotes, usage.notes);
  const tools: any = createCoreToolService({}, {}, {}, {}, undefined, {
    browserPairing: {} as any,
    ...usage.tools,
  });
  assert.equal(tools.deps.connectorNotes, usage.notes);
  await usage.close();
  db.close();
});
