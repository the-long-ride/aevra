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

test('resolves external mounts configured or accessed by absolute host path', async () => {
  const wsDir = mkdtempSync(path.join(os.tmpdir(), 'aevra-ws-'));
  const extAliasDir = mkdtempSync(path.join(os.tmpdir(), 'aevra-ext-alias-'));
  const extAbsDir = mkdtempSync(path.join(os.tmpdir(), 'aevra-ext-abs-'));
  const outsideDir = mkdtempSync(path.join(os.tmpdir(), 'aevra-outside-'));

  writeFileSync(path.join(extAliasDir, 'icon.svg'), '<svg/>');
  writeFileSync(path.join(extAbsDir, 'shared.ts'), 'export const x = 1;');
  writeFileSync(path.join(outsideDir, 'nope.txt'), 'nope');

  const canonicalAliasFile = await realpath(path.join(extAliasDir, 'icon.svg'));
  const canonicalAbsFile = await realpath(path.join(extAbsDir, 'shared.ts'));

  const roots = [
    {
      id: 'w',
      kind: 'workspace' as const,
      logicalPrefix: '/',
      hostRoot: wsDir,
      capabilities: ['files.read' as const, 'files.write' as const],
    },
    {
      id: 'm-alias',
      kind: 'external' as const,
      logicalPrefix: '/design-icons',
      hostRoot: extAliasDir,
      capabilities: ['files.read' as const],
    },
    {
      id: 'm-abs',
      kind: 'external' as const,
      logicalPrefix: extAbsDir,
      hostRoot: extAbsDir,
      capabilities: ['files.read' as const],
    },
  ];

  // Access via logical alias
  const byLogical = await resolveCapabilityPath('/design-icons/icon.svg', roots, 'read');
  assert.equal(byLogical.rootId, 'm-alias');
  assert.equal(byLogical.canonicalHostPath, canonicalAliasFile);

  // Access alias mount via its absolute host path
  const byHostOnAlias = await resolveCapabilityPath(
    path.join(extAliasDir, 'icon.svg'),
    roots,
    'read',
  );
  assert.equal(byHostOnAlias.rootId, 'm-alias');
  assert.equal(byHostOnAlias.canonicalHostPath, canonicalAliasFile);

  // Access mount configured directly with an absolute path in logicalPrefix
  const byAbsMount = await resolveCapabilityPath(path.join(extAbsDir, 'shared.ts'), roots, 'read');
  assert.equal(byAbsMount.rootId, 'm-abs');
  assert.equal(byAbsMount.canonicalHostPath, canonicalAbsFile);

  // Rejects unmounted absolute path outside workspace and mounts
  await assert.rejects(
    () => resolveCapabilityPath(path.join(outsideDir, 'nope.txt'), roots, 'read'),
    /escapes/,
  );

  // Rejects dot-dot traversal out of an absolute mount
  await assert.rejects(
    () => resolveCapabilityPath(`${extAbsDir}/../outside`, roots, 'read'),
    /escapes/,
  );
});
