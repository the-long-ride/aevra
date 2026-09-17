import assert from 'node:assert/strict';
import test from 'node:test';
import {
  UPSTREAM_NAME_PATTERN,
  assertValidUpstreamName,
} from '../src/mcp-upstream/upstream-records.js';

test('a name can never contain the namespace separator', () => {
  for (const name of ['file__read', 'a__b', '__', 'x_y'])
    assert.throws(() => assertValidUpstreamName(name), /MCP_UPSTREAM_NAME_INVALID/);
  assert.equal(UPSTREAM_NAME_PATTERN.test('file__read'), false);
});

test('a name cannot smuggle a uri scheme, a path, or a wildcard', () => {
  for (const name of ['a:b', 'a/b', 'a*', '*', 'a.b', 'a+b', 'a%2f'])
    assert.throws(() => assertValidUpstreamName(name), /MCP_UPSTREAM_NAME_INVALID/);
});

test('the name rule is anchored', () => {
  assert.throws(() => assertValidUpstreamName('github\nevil'), /MCP_UPSTREAM_NAME_INVALID/);
  assert.throws(() => assertValidUpstreamName('github\0'), /MCP_UPSTREAM_NAME_INVALID/);
});

test('a non-string name is refused rather than coerced', () => {
  for (const name of [null, undefined, 42, {}, ['github']])
    assert.throws(() => assertValidUpstreamName(name), /MCP_UPSTREAM_NAME_INVALID/);
});
