import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileRead, fileSearch } from '../src/files.js';
test('file primitives return logical metadata without host path', async () => {
  const d = mkdtempSync(path.join(os.tmpdir(), 'aevra-files-'));
  writeFileSync(path.join(d, 'a.txt'), 'hello world');
  const roots = [
    {
      id: 'w',
      kind: 'workspace' as const,
      logicalPrefix: '/',
      hostRoot: d,
      capabilities: [
        'files.read' as const,
        'files.search' as const,
        'files.write' as const,
        'files.delete' as const,
      ],
    },
  ];
  const r = await fileRead('/a.txt', roots);
  assert.equal(r.content, 'hello world');
  assert.equal('hostPath' in r, false);
  assert.equal((await fileSearch('/', 'world', roots)).hits[0]!.path, '/a.txt');

  const { fileList, fileCreate, fileWrite, fileMove, fileDelete } = await import('../src/files.js');
  const { entries: list } = await fileList('/', roots);
  assert.ok(list.some((item) => item.name === 'a.txt'));

  await fileCreate('/b.txt', 'content b', roots, 'utf8');
  assert.equal((await fileRead('/b.txt', roots)).content, 'content b');

  await fileWrite('/b.txt', 'updated b', roots, 'utf8');
  assert.equal((await fileRead('/b.txt', roots)).content, 'updated b');

  const { mkdirSync } = await import('node:fs');
  mkdirSync(path.join(d, 'nested'), { recursive: true });

  await fileCreate(
    '/nested/sub.txt',
    Buffer.from('hello nested').toString('base64'),
    roots,
    'base64',
  );
  assert.equal((await fileRead('/nested/sub.txt', roots)).content, 'hello nested');

  const { hits: nestedSearch } = await fileSearch('/', 'nested', roots);
  assert.ok(nestedSearch.some((h) => h.path === '/nested/sub.txt'));

  const { entries: subList } = await fileList('/nested', roots);
  assert.ok(subList.some((item) => item.name === 'sub.txt'));

  await fileWrite(
    '/nested/sub.txt',
    Buffer.from('updated nested').toString('base64'),
    roots,
    'base64',
  );
  assert.equal((await fileRead('/nested/sub.txt', roots)).content, 'updated nested');

  await fileDelete('/nested', true, roots);
  await assert.rejects(() => fileRead('/nested/sub.txt', roots));

  // SENSITIVE file search masking
  writeFileSync(path.join(d, 'credentials.json'), '{\n  "api_key": "my-secret-key"\n}\n');
  const { hits: sensitiveSearch } = await fileSearch('/', 'my-secret-key', roots);
  assert.ok(sensitiveSearch.length > 0);
  assert.ok(sensitiveSearch[0]?.text.includes('[REDACTED]'));

  // SECRET file mutation rejection
  await assert.rejects(() => fileWrite('/.env', 'SECRET=1', roots), /Protected secret resource/);

  // SENSITIVE alias mutation rejection
  const aliasRoots = [
    {
      id: 'alias-root',
      kind: 'workspace' as const,
      logicalPrefix: '/normal-alias',
      hostRoot: path.join(d, 'credentials.json'),
      capabilities: ['files.write' as const],
    },
  ];
  await assert.rejects(
    () => fileWrite('/normal-alias', 'new-creds', aliasRoots),
    /Sensitive alias requires its classified path/,
  );
});
