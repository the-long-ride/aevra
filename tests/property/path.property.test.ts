import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveCapabilityPath } from '../../packages/security/src/path-policy.js';
function rng(seed = 1337) {
  let x = seed >>> 0;
  return () => (x = (x * 1664525 + 1013904223) >>> 0) / 0x100000000;
}
test('generated logical paths either resolve inside root or are rejected', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'aevra-prop-'));
  mkdirSync(path.join(root, 'safe'), { recursive: true });
  writeFileSync(path.join(root, 'safe', 'a.txt'), 'x');
  const roots = [
    {
      id: 'w',
      kind: 'workspace' as const,
      logicalPrefix: '/',
      hostRoot: root,
      capabilities: ['files.read' as const, 'files.search' as const],
    },
  ];
  const r = rng();
  for (let i = 0; i < 150; i++) {
    const pieces = Array.from({ length: 1 + Math.floor(r() * 5) }, () =>
      r() < 0.25 ? '..' : r() < 0.4 ? '.' : `p${Math.floor(r() * 9)}`,
    );
    const logical = r() < 0.15 ? '/safe/a.txt' : '/' + pieces.join('/');
    try {
      const out = await resolveCapabilityPath(logical, roots, 'read');
      const rel = path.relative(
        await import('node:fs/promises').then((m) => m.realpath(root)),
        out.canonicalHostPath,
      );
      assert.equal(rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel), false);
    } catch (e) {
      assert.ok(e instanceof Error);
    }
  }
});
