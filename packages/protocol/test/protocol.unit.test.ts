import assert from 'node:assert/strict';
import test from 'node:test';
import * as protocol from '../src/index.js';
import { parseOperationEnvelope } from '../src/worker.js';
test('legacy browser protocol is gone', () => {
  for (const key of ['boundProjectSchema', 'handoffSnapshotSchema', 'wsClientMessageSchema'])
    assert.equal(key in protocol, false);
});
test('operation envelope accepts v1 known kinds only', () => {
  const base = {
    version: 1,
    daemonInstanceId: 'd',
    operationId: 'o',
    sessionId: 's',
    workspaceId: 'w',
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 1000).toISOString(),
    nonce: 'n',
    executionMode: 'sandbox',
    capabilityRoots: [],
    operation: { kind: 'file.read', path: 'x' },
    mac: 'm',
  };
  assert.equal(parseOperationEnvelope(base).version, 1);
  assert.throws(() => parseOperationEnvelope('not-an-object'), /Expected object/);
  assert.throws(() => parseOperationEnvelope({ ...base, version: 2 }), /version/);
  assert.throws(
    () => parseOperationEnvelope({ ...base, operation: { kind: 'raw.run' } }),
    /Unknown operation/,
  );
  assert.throws(
    () => parseOperationEnvelope({ ...base, operation: 'not-an-object' }),
    /Expected object/,
  );
  assert.throws(
    () => parseOperationEnvelope({ ...base, daemonInstanceId: '' }),
    /Invalid daemonInstanceId/,
  );
  assert.throws(
    () => parseOperationEnvelope({ ...base, executionMode: 'invalid' }),
    /Invalid executionMode/,
  );
  assert.throws(
    () => parseOperationEnvelope({ ...base, capabilityRoots: 'not-an-array' }),
    /Invalid capabilityRoots/,
  );
});
