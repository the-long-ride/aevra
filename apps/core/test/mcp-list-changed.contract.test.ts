import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { modernDiscoverResult } from '../src/mcp/modern-protocol.js';

test('the modern discovery result declares all three lists as changeable', () => {
  const capabilities: any = modernDiscoverResult('https://example.test').capabilities;
  assert.equal(capabilities.tools.listChanged, true);
  assert.equal(capabilities.resources.listChanged, true);
  assert.equal(capabilities.prompts.listChanged, true);
});

test('the legacy initialize handshake declares all three lists as changeable', () => {
  const source = readFileSync(join(process.cwd(), 'apps/core/src/mcp/server.ts'), 'utf8');
  assert.match(source, /tools: \{ listChanged: true \}/);
  assert.match(source, /resources: \{ listChanged: true \}/);
  assert.match(source, /prompts: \{ listChanged: true \}/);
});
