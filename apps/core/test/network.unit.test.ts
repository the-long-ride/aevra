import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyNetworkDestination, validateNetworkRuleHost } from '../src/policy/network.js';
test('known package destinations map to operation families', () => {
  assert.equal(
    classifyNetworkDestination('https://registry.npmjs.org/foo').family,
    'network.package.npm',
  );
  assert.equal(
    classifyNetworkDestination('https://api.nuget.org/v3').family,
    'network.package.nuget',
  );
  assert.match(classifyNetworkDestination('https://example.com').family, /network\.host/);
});
test('wildcards are never inferred', () =>
  assert.throws(() => validateNetworkRuleHost('*.example.com'), /Wildcard/));
