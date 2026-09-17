import assert from 'node:assert/strict';
import test from 'node:test';
import { STABLE_TOOL_NAMES } from '../src/registry.js';
import {
  UPSTREAM_NAME_PATTERN,
  isUpstreamName,
  proxyName,
  proxyResourceUri,
  splitProxyName,
  splitProxyResourceUri,
} from '../src/upstream-names.js';

test('a proxied tool name can never collide with a built-in tool name', () => {
  for (const name of STABLE_TOOL_NAMES) {
    assert.ok(!name.includes('__'), `built-in tool ${name} contains the proxy separator`);
    assert.equal(splitProxyName(name), null, `built-in tool ${name} parsed as a proxied name`);
  }
});

test('the server-name pattern cannot admit a name containing the separator', () => {
  assert.ok(!isUpstreamName('git__hub'));
  assert.ok(!isUpstreamName('a_b'));
  assert.ok(!isUpstreamName('-lead'));
  assert.ok(!isUpstreamName('Upper'));
  assert.ok(!isUpstreamName(''));
  assert.ok(!isUpstreamName('a'.repeat(33)));
  assert.ok(isUpstreamName('github'));
  assert.ok(isUpstreamName('a'.repeat(32)));
  assert.ok(isUpstreamName('0-a-9'));
  assert.equal(UPSTREAM_NAME_PATTERN.source, '^[a-z0-9][a-z0-9-]{0,31}$');
});

test('the split takes the first separator, so an upstream tool may contain one', () => {
  assert.equal(proxyName('github', 'search__issues'), 'github__search__issues');
  assert.deepEqual(splitProxyName('github__search__issues'), {
    server: 'github',
    entry: 'search__issues',
  });
});

test('a malformed public name yields no reference rather than a guessed one', () => {
  assert.equal(splitProxyName('__search'), null);
  assert.equal(splitProxyName('github__'), null);
  assert.equal(splitProxyName('github'), null);
  assert.equal(splitProxyName('GitHub__search'), null);
});

test('resource URIs round-trip through the mcp+ prefix', () => {
  assert.equal(proxyResourceUri('github', 'repo://readme'), 'mcp+github://repo://readme');
  assert.deepEqual(splitProxyResourceUri('mcp+github://repo://readme'), {
    server: 'github',
    entry: 'repo://readme',
  });
  assert.equal(splitProxyResourceUri('aevra://skill/user/writing'), null);
  assert.equal(splitProxyResourceUri('mcp+github://'), null);
  assert.equal(splitProxyResourceUri('mcp+GitHub://x'), null);
});
