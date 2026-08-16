import assert from 'node:assert/strict';
import test from 'node:test';
import { knownNetworkFamily, normalizeDestination } from '../src/network.js';

test('normalizeDestination parses hosts, ports, and protocols', () => {
  assert.deepEqual(normalizeDestination('https://github.com:8443'), {
    protocol: 'https',
    host: 'github.com',
    port: 8443,
  });
  assert.deepEqual(normalizeDestination('http://example.com'), {
    protocol: 'http',
    host: 'example.com',
    port: 80,
  });
  assert.deepEqual(normalizeDestination('ssh://github.com'), {
    protocol: 'ssh',
    host: 'github.com',
    port: 22,
  });
  assert.deepEqual(normalizeDestination('registry.npmjs.org'), {
    protocol: 'https',
    host: 'registry.npmjs.org',
    port: 443,
  });
  assert.deepEqual(normalizeDestination('custom://host.domain'), {
    protocol: 'custom',
    host: 'host.domain',
    port: 443,
  });
});

test('knownNetworkFamily identifies registry package ecosystems', () => {
  assert.equal(knownNetworkFamily('registry.npmjs.org'), 'network.package.npm');
  assert.equal(knownNetworkFamily('pkg.npmjs.org'), 'network.package.npm');
  assert.equal(knownNetworkFamily('crates.io'), 'network.package.crates');
  assert.equal(knownNetworkFamily('static.crates.io'), 'network.package.crates');
  assert.equal(knownNetworkFamily('api.nuget.org'), 'network.package.nuget');
  assert.equal(knownNetworkFamily('dist.nuget.org'), 'network.package.nuget');
  assert.equal(knownNetworkFamily('example.com'), null);
});
