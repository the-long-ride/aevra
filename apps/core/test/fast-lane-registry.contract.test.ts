import assert from 'node:assert/strict';
import test from 'node:test';
import { toolDefinitions } from '../../../packages/mcp-tools/src/registry.js';

const hiddenSingularTools = [
  'file_read',
  'file_create',
  'file_write',
  'file_patch',
  'command_run',
] as const;

const fastLaneTools = ['file_read_many', 'file_write_many', 'command_run_many'] as const;

test('registry hides singular tools in favor of Fast Lane defaults', () => {
  const names = new Set(toolDefinitions().map((tool) => tool.name));

  for (const name of hiddenSingularTools) assert.equal(names.has(name), false, name);
  for (const name of fastLaneTools) assert.equal(names.has(name), true, name);
});
