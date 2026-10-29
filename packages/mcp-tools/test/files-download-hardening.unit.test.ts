import assert from 'node:assert/strict';
import test from 'node:test';
import { b64, makeHarness, MB } from './transfer-harness.js';

const inline = (path: string, text = 'alpha') => ({
  path,
  mimeType: 'text/plain',
  content: b64(text),
  encoding: 'base64' as const,
});
const call = (h: ReturnType<typeof makeHarness>, entries: unknown[]) =>
  h.service.call('s1', 'files_download', { workspaceId: 'w1', entries });

test('overwrite existence check never hashes; only a snapshot gets the hash', async () => {
  const h = makeHarness({
    yolo: 'do-whatever',
    existing: { '/in/small.txt': 100, '/in/huge.bin': 21 * MB },
  });
  try {
    await call(h, [
      { ...inline('/in/small.txt'), overwrite: true },
      { ...inline('/in/huge.bin'), overwrite: true },
    ]);
    const hugeStats = h.ops.filter(
      (o) => o.kind === 'files.upload.stat' && o.path === '/in/huge.bin',
    );
    assert.equal(hugeStats.length, 1);
    assert.equal(hugeStats[0].hash, false);
    const byPath = new Map(h.mutations.map((m) => [m.logicalPath, m]));
    assert.equal(byPath.get('/in/huge.bin').beforeHash, undefined);
    assert.equal(byPath.get('/in/small.txt').beforeHash, 'sha256:x');
  } finally {
    h.close();
  }
});

test('a failed overwrite discards the snapshot it took', async () => {
  const h = makeHarness({
    yolo: 'do-whatever',
    existing: { '/in/a.txt': 100, '/in/b.txt': 100 },
  });
  try {
    const result: any = await call(h, [
      {
        path: '/in/a.txt',
        mimeType: 'text/plain',
        url: 'https://private.example/y',
        overwrite: true,
      },
      {
        path: '/in/b.txt',
        mimeType: 'text/plain',
        url: 'https://private.example/x',
        overwrite: true,
      },
    ]);
    assert.equal(result.failed, 2);
    assert.equal(h.snapshots.length, 2);
    assert.equal(h.discarded.length, 2);
    assert.equal(h.mutations.length, 0);
  } finally {
    h.close();
  }
});

test('a successful overwrite keeps its snapshot', async () => {
  const h = makeHarness({ yolo: 'do-whatever', existing: { '/in/a.txt': 100 } });
  try {
    await call(h, [{ ...inline('/in/a.txt'), overwrite: true }]);
    assert.equal(h.discarded.length, 0);
  } finally {
    h.close();
  }
});
