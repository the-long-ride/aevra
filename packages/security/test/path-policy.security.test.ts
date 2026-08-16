import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveCapabilityPath } from '../src/path-policy.js';
test('symlink escape is blocked', async (t) => {
  if (process.platform === 'win32') {
    t.skip('symlink privileges vary on Windows CI');
    return;
  }
  const root = mkdtempSync(path.join(os.tmpdir(), 'aevra-root-')),
    outside = mkdtempSync(path.join(os.tmpdir(), 'aevra-out-'));
  writeFileSync(path.join(outside, 'secret'), 'x');
  symlinkSync(outside, path.join(root, 'link'));
  const roots = [
    {
      id: 'w',
      kind: 'workspace' as const,
      logicalPrefix: '/',
      hostRoot: root,
      capabilities: ['files.read' as const],
    },
  ];
  await assert.rejects(() => resolveCapabilityPath('/link/secret', roots, 'read'), /escapes/);
});
