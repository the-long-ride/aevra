import assert from 'node:assert/strict';
import test from 'node:test';
import { toolDefinitions } from '../src/registry.js';

test('control efficiency tools are discoverable with bounded schemas and annotations', () => {
  const definitions = new Map(toolDefinitions().map((tool) => [tool.name, tool]));
  for (const name of [
    'control_observe',
    'control_execute',
    'control_plan_status',
    'control_plan_cancel',
    'desktop_act_many',
  ] as const) {
    assert.ok(definitions.get(name), `missing ${name}`);
  }

  assert.equal(definitions.get('control_observe')!.annotations.readOnlyHint, true);
  assert.equal(definitions.get('control_plan_status')!.annotations.readOnlyHint, true);
  assert.equal(definitions.get('control_execute')!.annotations.destructiveHint, true);
  assert.equal(definitions.get('control_execute')!.annotations.openWorldHint, true);
  const actMany = definitions.get('desktop_act_many') as any;
  assert.equal(actMany.inputSchema.properties.actions.maxItems, 32);
});
