import assert from 'node:assert/strict';
import test from 'node:test';
import { AevraDatabase } from '../../../packages/store/src/database.js';
import { SettingsRepository } from '../../../packages/store/src/settings.js';
import { createRuntimeUsage } from '../src/usage/runtime-usage.js';

test('createRuntimeUsage wires meter and profiles and flushes on close', async () => {
  const db = AevraDatabase.open(':memory:');
  const usage = createRuntimeUsage(db.raw(), new SettingsRepository(db.raw()));
  const meter = usage.mcp.usage;
  meter.finish(meter.begin('connector:alpha', 'tools/call', 'file_list', {}), '{}');
  usage.profiles.set('connector:alpha', { toolGroups: ['files'] });
  assert.deepEqual(usage.mcp.connectorProfile('connector:alpha'), { toolGroups: ['files'] });
  assert.equal(usage.mcp.connectorProfile('connector:beta'), undefined);
  await usage.close();
  const rows = db.raw().prepare('SELECT calls FROM token_usage').all() as any[];
  assert.equal(rows.length, 1);
  assert.equal(rows[0].calls, 1);
  assert.equal(usage.admin.usage, usage.meter);
  assert.equal(usage.admin.connectorProfiles, usage.profiles);
  db.close();
});
