import assert from 'node:assert/strict';
import test from 'node:test';
import { parseOperationEnvelope } from '../../../packages/protocol/src/worker.js';

const base = {
  version: 1,
  daemonInstanceId: 'd',
  operationId: 'o',
  sessionId: 's',
  workspaceId: '',
  issuedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 30000).toISOString(),
  nonce: 'n',
  executionMode: 'host',
  capabilityRoots: [],
  mac: 'm',
  scope: {
    kind: 'host-control',
    capability: 'browser.control',
    identity: { kind: 'session', key: 's' },
  },
};

test('host-control envelope rejects filesystem, wrong family, and nonempty roots', () => {
  assert.equal(
    parseOperationEnvelope({ ...base, operation: { kind: 'browser.status' } }).scope?.kind,
    'host-control',
  );
  assert.throws(
    () => parseOperationEnvelope({ ...base, operation: { kind: 'file.read', path: '/secret' } }),
    /HOST_CONTROL_SCOPE_INVALID/,
  );
  assert.throws(
    () => parseOperationEnvelope({ ...base, operation: { kind: 'desktop.status' } }),
    /HOST_CONTROL_SCOPE_INVALID/,
  );
  assert.throws(
    () =>
      parseOperationEnvelope({
        ...base,
        capabilityRoots: [{ id: 'root', hostRoot: '/tmp' }],
        operation: { kind: 'browser.status' },
      }),
    /HOST_CONTROL_SCOPE_INVALID/,
  );
});
