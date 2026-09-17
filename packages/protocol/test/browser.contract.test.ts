import assert from 'node:assert/strict';
import test from 'node:test';
import { parseOperationEnvelope } from '../src/worker.js';
import { BROWSER_OPERATION_KINDS } from '../src/browser.js';

const base = {
  version: 1,
  daemonInstanceId: 'd',
  operationId: 'o',
  sessionId: 's',
  workspaceId: 'w',
  issuedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 1000).toISOString(),
  nonce: 'n',
  executionMode: 'host',
  capabilityRoots: [],
  mac: 'm',
};

test('envelope accepts every browser operation kind', () => {
  const samples: Record<string, unknown> = {
    'browser.connect': { kind: 'browser.connect', transport: 'cdp', cdpPort: 9222 },
    'browser.tabs': { kind: 'browser.tabs', action: 'list' },
    'browser.navigate': { kind: 'browser.navigate', url: 'https://example.com', waitUntil: 'load' },
    'browser.snapshot': { kind: 'browser.snapshot', mode: 'a11y', maxNodes: 200 },
    'browser.read': { kind: 'browser.read', format: 'text' },
    'browser.act': { kind: 'browser.act', actions: [], stopOnError: true },
    'browser.logs': { kind: 'browser.logs', logKind: 'console', limit: 50 },
    'browser.disconnect': { kind: 'browser.disconnect' },
    'browser.status': { kind: 'browser.status' },
  };
  for (const kind of BROWSER_OPERATION_KINDS) {
    const operation = samples[kind];
    assert.ok(operation, `missing sample for ${kind}`);
    assert.equal(parseOperationEnvelope({ ...base, operation }).version, 1);
  }
});

test('envelope rejects a browser-looking kind that is not registered', () => {
  assert.throws(
    () => parseOperationEnvelope({ ...base, operation: { kind: 'browser.evaluate' } }),
    /Unknown operation kind/,
  );
});
