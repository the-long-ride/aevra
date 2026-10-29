import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { VerifiedEnvelope } from '../../../packages/protocol/src/worker.js';
import { dispatchWorkerOperation } from '../src/dispatcher.js';

function envelope(root: string, operation: Record<string, unknown>): VerifiedEnvelope {
  return {
    version: 1,
    daemonInstanceId: 'daemon',
    operationId: 'op',
    sessionId: 'session',
    workspaceId: 'workspace',
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    nonce: 'nonce',
    executionMode: 'host',
    capabilityRoots: [
      {
        id: 'root',
        kind: 'workspace',
        logicalPrefix: '/',
        hostRoot: root,
        capabilities: ['files.read', 'files.write'],
      },
    ],
    operation: operation as any,
    mac: 'mac',
    verifiedAt: new Date().toISOString(),
  };
}

async function* one() {
  yield Uint8Array.from(Buffer.from('plain words'));
}

test('download entries without finite positive bounds are refused', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'aevra-xfer-validate-'));
  try {
    const good = {
      kind: 'files.download.entry',
      path: '/a.txt',
      mimeType: 'text/plain',
      overwrite: false,
      source: { type: 'inline' },
      maxBytes: 1000,
      timeoutMs: 1000,
    };
    const bad: Array<Record<string, unknown>> = [
      { ...good, maxBytes: undefined },
      { ...good, maxBytes: 0 },
      { ...good, maxBytes: -5 },
      { ...good, maxBytes: Number.NaN },
      { ...good, maxBytes: Number.POSITIVE_INFINITY },
      { ...good, maxBytes: '1000' },
      { ...good, timeoutMs: undefined },
      { ...good, timeoutMs: 0 },
      { ...good, timeoutMs: Number.NaN },
    ];
    for (const operation of bad) {
      const result = await dispatchWorkerOperation(envelope(root, operation), { upload: one() });
      assert.equal(result.ok, false, JSON.stringify(operation));
      assert.equal(!result.ok && result.error.code, 'INVALID_REQUEST', JSON.stringify(operation));
    }
    const ok = await dispatchWorkerOperation(envelope(root, good), { upload: one() });
    assert.equal(ok.ok, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
