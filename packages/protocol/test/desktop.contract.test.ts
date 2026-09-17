import assert from 'node:assert/strict';
import test from 'node:test';
import { parseOperationEnvelope } from '../src/worker.js';
import { DESKTOP_OPERATION_KINDS } from '../src/desktop.js';

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

test('every desktop operation kind is namespaced and unique', () => {
  const kinds = [...DESKTOP_OPERATION_KINDS];
  assert.ok(kinds.length > 0);
  assert.equal(new Set(kinds).size, kinds.length);
  for (const kind of kinds) assert.match(kind, /^desktop\.[a-z]+$/);
});

test('envelope accepts every desktop operation kind', () => {
  const samples: Record<string, unknown> = {
    'desktop.connect': { kind: 'desktop.connect' },
    'desktop.status': { kind: 'desktop.status' },
    'desktop.disconnect': { kind: 'desktop.disconnect' },
    'desktop.apps': { kind: 'desktop.apps' },
    'desktop.windows': { kind: 'desktop.windows' },
    'desktop.describe': { kind: 'desktop.describe', maxNodes: 200, interactiveOnly: false },
    'desktop.capture': { kind: 'desktop.capture' },
    'desktop.act': {
      kind: 'desktop.act',
      op: 'click',
      policy: { mode: 'allowlist', applications: [], unattributedInput: 'deny' },
    },
  };
  for (const kind of DESKTOP_OPERATION_KINDS) {
    const operation = samples[kind];
    assert.ok(operation, `missing sample for ${kind}`);
    assert.equal(parseOperationEnvelope({ ...base, operation }).version, 1);
  }
});

test('envelope rejects a desktop-looking kind that is not registered', () => {
  assert.throws(
    () => parseOperationEnvelope({ ...base, operation: { kind: 'desktop.unknown' } }),
    /Unknown operation kind/,
  );
});
