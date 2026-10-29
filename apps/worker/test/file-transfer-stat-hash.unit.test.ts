import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

test('stat with hash false skips the hash; a non-boolean hash is refused', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'aevra-xfer-stat-'));
  try {
    writeFileSync(path.join(root, 'a.txt'), 'plain words');
    const fast: any = await dispatchWorkerOperation(
      envelope(root, { kind: 'files.upload.stat', path: '/a.txt', hash: false }),
    );
    assert.equal(fast.ok, true);
    assert.equal(fast.value.bytes, 11);
    assert.equal(fast.value.sha256, undefined);
    const full: any = await dispatchWorkerOperation(
      envelope(root, { kind: 'files.upload.stat', path: '/a.txt' }),
    );
    assert.match(full.value.sha256, /^sha256:/);
    const bad: any = await dispatchWorkerOperation(
      envelope(root, { kind: 'files.upload.stat', path: '/a.txt', hash: 'no' }),
    );
    assert.equal(bad.ok, false);
    assert.equal(bad.error.code, 'INVALID_REQUEST');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
