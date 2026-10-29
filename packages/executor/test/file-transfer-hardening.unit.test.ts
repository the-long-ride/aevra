import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { CapabilityRoot } from '../../protocol/src/index.js';
import { downloadEntry, uploadStat } from '../src/file-transfer.js';
import { discardSnapshot } from '../src/recovery.js';

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'aevra-transfer-h-'));
  const roots: CapabilityRoot[] = [
    {
      id: 'root',
      kind: 'workspace',
      logicalPrefix: '/',
      hostRoot: root,
      capabilities: ['files.read', 'files.write'],
    },
  ];
  return { root, roots, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

async function* chunks(text: string) {
  yield Uint8Array.from(Buffer.from(text));
}

test('a 250 char target name downloads (temp name stays under NAME_MAX)', async () => {
  const f = fixture();
  try {
    const name = `${'n'.repeat(246)}.txt`;
    assert.equal(name.length, 250);
    const result = await downloadEntry(
      {
        kind: 'files.download.entry',
        path: `/${name}`,
        mimeType: 'text/plain',
        overwrite: false,
        source: { type: 'inline' },
        maxBytes: 1000,
        timeoutMs: 5000,
      },
      f.roots,
      { upload: chunks('plain words') },
    );
    assert.equal(result.bytes, 11);
    assert.equal(readFileSync(path.join(f.root, name), 'utf8'), 'plain words');
  } finally {
    f.cleanup();
  }
});

test('stat with hash false returns size and type but no hash', async () => {
  const f = fixture();
  try {
    writeFileSync(path.join(f.root, 'doc.pdf'), Buffer.from('%PDF-1.7\nbody words'));
    const stat: any = await uploadStat('/doc.pdf', f.roots, undefined, { hash: false });
    assert.equal(stat.bytes, 19);
    assert.equal(stat.sha256, undefined);
    assert.equal(stat.mimeType, 'application/pdf');
    const full: any = await uploadStat('/doc.pdf', f.roots);
    assert.match(full.sha256, /^sha256:/);
  } finally {
    f.cleanup();
  }
});

test('discardSnapshot removes a snapshot file and refuses other names', async () => {
  const f = fixture();
  try {
    const snap = path.join(f.root, 'op_1.before');
    writeFileSync(snap, 'old words');
    assert.deepEqual(await discardSnapshot(snap), { discarded: true });
    assert.equal(existsSync(snap), false);
    await discardSnapshot(snap);
    await assert.rejects(() => discardSnapshot(path.join(f.root, 'keep.txt')), /recovery snapshot/);
  } finally {
    f.cleanup();
  }
});
