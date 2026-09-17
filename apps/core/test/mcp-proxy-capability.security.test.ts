import assert from 'node:assert/strict';
import test from 'node:test';
import type { Capability } from '../../../packages/protocol/src/index.js';
import { ALL_CAPABILITIES } from '../src/policy/capabilities.js';
import { capabilityOrder } from '../src/policy/permissions.js';

const EVERY_CAPABILITY: Record<Capability, true> = {
  'files.read': true,
  'files.search': true,
  'git.read': true,
  'files.write': true,
  'files.delete': true,
  'commands.run': true,
  'git.commit': true,
  'git.push': true,
  network: true,
  'skills.read': true,
  'skills.write': true,
  'instructions.read': true,
  'instructions.write': true,
  'browser.control': true,
  'desktop.control': true,
  'mcp.proxy': true,
};

test('every declared capability is ranked in capabilityOrder', () => {
  assert.deepEqual([...capabilityOrder].sort(), Object.keys(EVERY_CAPABILITY).sort());
});

test('mcp.proxy is not granted by any built-in capability profile', () => {
  assert.ok(!ALL_CAPABILITIES.includes('mcp.proxy'));
});
