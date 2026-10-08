import assert from 'node:assert/strict';
import test from 'node:test';
import { toolDefinitions } from '../src/registry.js';

const byName = (name: string) => toolDefinitions().find((tool) => tool.name === name) as any;

test('command tools accept maxOutputChars', () => {
  for (const name of ['shell_run', 'command_run_many']) {
    const property = byName(name).inputSchema.properties.maxOutputChars;
    assert.equal(property.type, 'integer', name);
    assert.equal(property.minimum, 256, name);
    assert.equal(property.maximum, 200000, name);
  }
});

test('approval read tools accept detail summary|full', () => {
  for (const name of ['approval_status', 'approval_wait']) {
    assert.deepEqual(byName(name).inputSchema.properties.detail.enum, ['summary', 'full'], name);
  }
});

test('approval_cancel keeps its original shape', () => {
  assert.equal(byName('approval_cancel').inputSchema.properties.detail, undefined);
});
