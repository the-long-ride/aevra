import assert from 'node:assert/strict';
import test from 'node:test';
import { ReadVersionCache } from '../src/operations/read-version-cache.js';
test('read cache is keyed by session workspace path hash', () => {
  const c = new ReadVersionCache(2);
  c.put({ sessionId: 's', workspaceId: 'w', path: '/a', hash: 'h', content: 'x', storedAt: 1 });
  assert.equal(c.get('s', 'w', '/a', 'h')?.content, 'x');
  assert.equal(c.get('s2', 'w', '/a', 'h'), null);
});
