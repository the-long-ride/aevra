import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveCapabilityPath } from '../src/path-policy.js';
test('resolves inside root and blocks dot-dot', async () => {
  const d = mkdtempSync(path.join(os.tmpdir(), 'aevra-path-'));
  const canonicalRoot = await realpath(d);
  writeFileSync(path.join(d, 'a.txt'), 'x');
  const roots = [
    {
      id: 'w',
      kind: 'workspace' as const,
      logicalPrefix: '/',
      hostRoot: d,
      capabilities: ['files.read' as const, 'files.write' as const],
    },
  ];
  assert.match((await resolveCapabilityPath('/a.txt', roots, 'read')).canonicalHostPath, /a\.txt$/);
  assert.match(
    (await resolveCapabilityPath('/a.txt', roots, 'write')).canonicalHostPath,
    /a\.txt$/,
  );
  assert.equal(
    (
      await resolveCapabilityPath(
        '/',
        [
          {
            id: 'w',
            kind: 'workspace' as const,
            logicalPrefix: '/',
            hostRoot: d,
            capabilities: ['commands.run' as const],
          },
        ],
        'command',
      )
    ).canonicalHostPath,
    canonicalRoot,
  );
  await assert.rejects(() => resolveCapabilityPath('/../secret', roots, 'write'), /escapes/);
  await assert.rejects(() => resolveCapabilityPath('/sub/../../outside', roots, 'read'), /escapes/);
});
