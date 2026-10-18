import { resolveCapabilityPath } from '../../security/src/path-policy.js';
import { revalidateMutationPath } from '../src/file-mutations.js';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  renameSync,
  symlinkSync,
  watch,
  rmSync,
  writeFileSync,
  readFileSync,
} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import test from 'node:test';
import { fileWrite } from '../src/files.js';
import type { CapabilityRoot } from '../../protocol/src/index.js';

// The race needs fs.watch to report the temp file while it is still being written.
// Windows refuses to replace the open directory (EPERM), and macOS FSEvents batches events with a
// delay that can outlast the whole write, so the swap lands after the write finished and nothing is
// left to reject. The ordering-free check below covers the revalidation itself on every platform.
function skipReason(): string | false {
  if (process.platform === 'win32') return 'Windows refuses replacing the open directory (EPERM)';
  if (process.platform === 'darwin')
    return 'FSEvents reports the temp file too late to race the write';
  return false;
}

test(
  'a parent swapped for a junction during an atomic write is rejected by containment revalidation',
  {
    skip: skipReason(),
  },
  async () => {
    const fixture = mkdtempSync(path.join(os.tmpdir(), 'aevra-write-race-'));
    const root = path.join(fixture, 'root');
    const parent = path.join(root, 'inside');
    const outside = path.join(fixture, 'outside');
    mkdirSync(parent, { recursive: true });
    mkdirSync(outside);
    writeFileSync(path.join(outside, 'target.txt'), 'unchanged outside words');
    let swapped = false;
    const watcher = watch(parent, (_event, name) => {
      if (!swapped && String(name).includes('.aevra-')) {
        swapped = true;
        watcher.close();
        renameSync(parent, path.join(root, 'moved'));
        symlinkSync(outside, parent, 'junction');
      }
    });
    const roots: CapabilityRoot[] = [
      {
        id: 'root',
        kind: 'workspace',
        logicalPrefix: '/',
        hostRoot: root,
        capabilities: ['files.write'],
      },
    ];
    try {
      await assert.rejects(
        () => fileWrite('/inside/target.txt', 'ordinary words '.repeat(500_000), roots),
        (error: any) => error.code === 'WORKSPACE_ESCAPE',
      );
      assert.equal(swapped, true);
      assert.equal(
        readFileSync(path.join(outside, 'target.txt'), 'utf8'),
        'unchanged outside words',
      );
    } finally {
      watcher.close();
      rmSync(fixture, { recursive: true, force: true });
    }
  },
);

test('containment revalidation refuses a junction that replaced a validated parent', async () => {
  const fixture = mkdtempSync(path.join(os.tmpdir(), 'aevra-revalidation-'));
  const root = path.join(fixture, 'root');
  const outside = path.join(fixture, 'outside');
  mkdirSync(path.join(root, 'inside'), { recursive: true });
  mkdirSync(outside);
  const roots: CapabilityRoot[] = [
    {
      id: 'root',
      kind: 'workspace',
      logicalPrefix: '/',
      hostRoot: root,
      capabilities: ['files.write'],
    },
  ];
  try {
    const resolved = await resolveCapabilityPath('/inside/target.txt', roots, 'write');
    renameSync(path.join(root, 'inside'), path.join(root, 'moved'));
    symlinkSync(outside, path.join(root, 'inside'), 'junction');
    await assert.rejects(() => revalidateMutationPath(resolved, roots), {
      code: 'WORKSPACE_ESCAPE',
    });
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
