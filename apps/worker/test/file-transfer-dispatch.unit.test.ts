import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { StreamError } from '../../../packages/ipc/src/stream.js';
import type { VerifiedEnvelope, WorkerOperation } from '../../../packages/protocol/src/worker.js';
import { parseOperationEnvelope } from '../../../packages/protocol/src/worker.js';
import { dispatchWorkerOperation } from '../src/dispatcher.js';

function setup() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'aevra-xfer-dispatch-'));
  const envelope = (operation: WorkerOperation): VerifiedEnvelope => ({
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
    operation,
    mac: 'mac',
    verifiedAt: new Date().toISOString(),
  });
  return { root, envelope, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

async function* one(text: string) {
  yield Uint8Array.from(Buffer.from(text));
}

test('the new operation kinds pass envelope parsing', () => {
  for (const kind of ['files.download.entry', 'files.upload.stat', 'files.upload.read']) {
    const parsed = parseOperationEnvelope({
      version: 1,
      daemonInstanceId: 'd',
      operationId: 'o',
      sessionId: 's',
      workspaceId: 'w',
      issuedAt: 'i',
      expiresAt: 'e',
      nonce: 'n',
      mac: 'm',
      executionMode: 'host',
      capabilityRoots: [],
      operation: { kind },
    });
    assert.equal(parsed.operation.kind, kind);
  }
});

test('download entry, stat and read run through the dispatcher with the stream context', async () => {
  const s = setup();
  try {
    const written = await dispatchWorkerOperation(
      s.envelope({
        kind: 'files.download.entry',
        path: '/in/a.txt',
        mimeType: 'text/plain',
        overwrite: false,
        source: { type: 'inline' },
        maxBytes: 1000,
        timeoutMs: 1000,
      }),
      { upload: one('plain words') },
    );
    assert.equal(written.ok, true);
    assert.equal(readFileSync(path.join(s.root, 'in', 'a.txt'), 'utf8'), 'plain words');
    const digest = `sha256:${createHash('sha256').update('plain words').digest('hex')}`;
    const stat = await dispatchWorkerOperation(
      s.envelope({ kind: 'files.upload.stat', path: '/in/a.txt' }),
    );
    assert.deepEqual(stat.ok && (stat.value as any).sha256, digest);
    const sent: Buffer[] = [];
    const read = await dispatchWorkerOperation(
      s.envelope({ kind: 'files.upload.read', path: '/in/a.txt', sha256: digest }),
      {
        download: async (chunk) => {
          sent.push(Buffer.from(chunk));
        },
      },
    );
    assert.equal(read.ok, true);
    assert.equal(Buffer.concat(sent).toString(), 'plain words');
  } finally {
    s.cleanup();
  }
});

test('errors before any byte moves come back as typed results', async () => {
  const s = setup();
  try {
    writeFileSync(path.join(s.root, '.env'), 'plain words');
    const secret = await dispatchWorkerOperation(
      s.envelope({ kind: 'files.upload.read', path: '/.env', sha256: 'x' }),
      { download: async () => {} },
    );
    assert.equal(secret.ok, false);
    assert.equal(!secret.ok && secret.error.code, 'CAPABILITY_REQUIRED');
    const noStream = await dispatchWorkerOperation(
      s.envelope({ kind: 'files.upload.read', path: '/a.txt', sha256: 'x' }),
    );
    assert.equal(!noStream.ok && noStream.error.code, 'INVALID_REQUEST');
    const noUpload = await dispatchWorkerOperation(
      s.envelope({
        kind: 'files.download.entry',
        path: '/b.txt',
        mimeType: 'text/plain',
        overwrite: false,
        source: { type: 'inline' },
        maxBytes: 10,
        timeoutMs: 1000,
      }),
    );
    assert.equal(!noUpload.ok && noUpload.error.code, 'INVALID_REQUEST');
  } finally {
    s.cleanup();
  }
});

test('a failure after bytes started aborts the stream with its code', async () => {
  const s = setup();
  try {
    writeFileSync(path.join(s.root, 'a.txt'), 'plain words');
    const digest = `sha256:${createHash('sha256').update('plain words').digest('hex')}`;
    await assert.rejects(
      () =>
        dispatchWorkerOperation(
          s.envelope({ kind: 'files.upload.read', path: '/a.txt', sha256: digest }),
          {
            download: async () => {
              throw new Error('socket went away');
            },
          },
        ),
      (e: any) => e instanceof StreamError && e.code === 'STREAM_SOURCE_ERROR',
    );
    await assert.rejects(
      () =>
        dispatchWorkerOperation(
          s.envelope({ kind: 'files.upload.read', path: '/a.txt', sha256: digest }),
          {
            download: async () => {
              throw new StreamError('STREAM_CANCELLED');
            },
          },
        ),
      (e: any) => e instanceof StreamError && e.code === 'STREAM_CANCELLED',
    );
  } finally {
    s.cleanup();
  }
});
