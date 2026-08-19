import assert from 'node:assert/strict';
import test from 'node:test';
import { HmacEnvelopeSigner } from '../../packages/ipc/src/envelope.js';
test('expired operation envelope cannot be replayed after authority loss', () => {
  const signer = new HmacEnvelopeSigner(Buffer.alloc(32, 7), 'daemon');
  const issued = new Date('2026-01-01T00:00:00Z');
  const e = signer.sign({
    version: 1,
    daemonInstanceId: 'daemon',
    operationId: 'op',
    sessionId: 's',
    workspaceId: 'w',
    issuedAt: issued.toISOString(),
    expiresAt: new Date(issued.getTime() + 1000).toISOString(),
    nonce: 'n',
    executionMode: 'host',
    capabilityRoots: [],
    operation: { kind: 'sandbox.inspect' },
  });
  assert.throws(() => signer.verify(e, new Date(issued.getTime() + 5000)), /expired/);
});
