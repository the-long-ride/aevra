import assert from 'node:assert/strict';
import test from 'node:test';
import { toolDefinitions } from '../src/registry.js';
import { b64, makeHarness, MB } from './transfer-harness.js';

const inline = (path: string, text = 'alpha') => ({
  path,
  mimeType: 'text/plain',
  content: b64(text),
  encoding: 'base64' as const,
});
const call = (h: ReturnType<typeof makeHarness>, entries: unknown[]) =>
  h.service.call('s1', 'files_download', { workspaceId: 'w1', entries });

test('files_download is destructive and open-world, never read-only', () => {
  const tool = toolDefinitions().find((t) => t.name === 'files_download')!;
  assert.ok(tool);
  assert.equal(tool.annotations.destructiveHint, true);
  assert.equal(tool.annotations.openWorldHint, true);
  assert.equal(tool.annotations.readOnlyHint, false);
  const schema = tool.inputSchema as any;
  assert.deepEqual(schema.required, ['entries']);
  assert.equal(schema.properties.entries.minItems, 1);
  assert.equal(schema.properties.entries.maxItems, 64);
});

test('a batch of 3 raises exactly one approval, then resume writes all three', async () => {
  const h = makeHarness();
  try {
    const pending: any = await call(h, [
      inline('/in/a.txt'),
      inline('/in/b.txt', 'bravo'),
      { path: '/in/c.txt', mimeType: 'text/plain', url: 'https://files.example/c.txt' },
    ]);
    assert.equal(pending.status, 'approval_pending');
    assert.equal(h.requests.length, 1);
    const op = h.requests[0].operation;
    assert.equal(op.family, 'files:transfer');
    assert.equal(op.capability, 'files.write');
    assert.equal(op.risk, 'HIGH');
    assert.equal(h.files.size, 0);

    assert.throws(() => h.approvals.approve(pending.requestId, 'session'), /one-time/);
    h.approvals.approve(pending.requestId, 'once');
    const done: any = await h.service.call('s1', 'approval_wait', { requestId: pending.requestId });
    assert.equal(done.ok, true);
    assert.equal(done.succeeded, 3);
    assert.deepEqual([...h.files.keys()].sort(), ['/in/a.txt', '/in/b.txt', '/in/c.txt']);
    assert.equal(h.files.get('/in/a.txt')!.toString(), 'alpha');
    assert.equal(h.requests.length, 1);
  } finally {
    h.close();
  }
});

test('do-whatever YOLO runs without approval; prevent-high-risk YOLO still asks (R1)', async () => {
  const free = makeHarness({ yolo: 'do-whatever' });
  try {
    const result: any = await call(free, [inline('/in/a.txt')]);
    assert.equal(result.succeeded, 1);
    assert.equal(free.requests.length, 0);
  } finally {
    free.close();
  }
  const strict = makeHarness({ yolo: 'prevent-high-risk' });
  try {
    const result: any = await call(strict, [inline('/in/a.txt')]);
    assert.equal(result.status, 'approval_pending');
    assert.equal(strict.requests.length, 1);
    assert.equal(strict.files.size, 0);
  } finally {
    strict.close();
  }
});

test('inline over the inline limit is INLINE_TOO_LARGE per entry', async () => {
  const h = makeHarness({
    yolo: 'do-whatever',
    limits: { maxFileMb: 1, maxBatchMb: 4, inlineMb: 1 },
  });
  try {
    const big = 'x'.repeat(MB + 10);
    const result: any = await call(h, [inline('/in/big.bin', big), inline('/in/ok.txt')]);
    assert.equal(result.ok, false);
    assert.equal(result.failed, 1);
    assert.equal(result.results[0].error.code, 'INLINE_TOO_LARGE');
    assert.equal(result.results[1].ok, true);
    assert.equal(h.files.has('/in/big.bin'), false);
  } finally {
    h.close();
  }
});

test('batch sum over the limit stops later entries with BATCH_LIMIT, earlier ones are written', async () => {
  const h = makeHarness({
    yolo: 'do-whatever',
    limits: { maxFileMb: 1, maxBatchMb: 1, inlineMb: 1 },
  });
  try {
    const part = 'y'.repeat(600 * 1024);
    const result: any = await call(h, [
      inline('/in/one.bin', part),
      inline('/in/two.bin', part),
      inline('/in/three.bin', 'tiny'),
    ]);
    assert.equal(result.results[0].ok, true);
    assert.equal(result.results[1].error.code, 'BATCH_LIMIT');
    assert.equal(result.results[2].ok, true);
    assert.equal(h.files.has('/in/one.bin'), true);
    assert.equal(h.files.has('/in/two.bin'), false);
  } finally {
    h.close();
  }
});

test('a protected target is a per-entry CAPABILITY_REQUIRED and nothing reaches the worker', async () => {
  const h = makeHarness({ yolo: 'do-whatever' });
  try {
    const result: any = await call(h, [inline('/.env'), inline('/in/fine.txt')]);
    assert.equal(result.results[0].error.code, 'CAPABILITY_REQUIRED');
    assert.equal(result.results[1].ok, true);
    assert.equal(h.files.has('/.env'), false);
    assert.equal(
      h.ops.some((op) => op.path === '/.env'),
      false,
    );
  } finally {
    h.close();
  }
});

test('worker failure codes become typed per-entry errors', async () => {
  const h = makeHarness({ yolo: 'do-whatever', existing: { '/in/old.txt': 10 } });
  try {
    const result: any = await call(h, [
      inline('/in/old.txt'),
      { path: '/in/p.txt', mimeType: 'text/plain', url: 'https://private.example/p' },
    ]);
    assert.equal(result.results[0].error.code, 'FILE_EXISTS');
    assert.equal(result.results[1].error.code, 'URL_NOT_PUBLIC');
    assert.equal(result.failed, 2);
  } finally {
    h.close();
  }
});

test('inline entries report EXECUTOR_UNAVAILABLE when the worker has no upload stream', async () => {
  const h = makeHarness({ yolo: 'do-whatever', noUploadStream: true });
  try {
    const result: any = await call(h, [inline('/in/a.txt')]);
    assert.equal(result.results[0].error.code, 'EXECUTOR_UNAVAILABLE');
  } finally {
    h.close();
  }
});

test('URL downloads get a size cap and a timeout that outlives a large transfer', async () => {
  const h = makeHarness({ yolo: 'do-whatever' });
  try {
    await call(h, [{ path: '/in/c.txt', mimeType: 'text/plain', url: 'https://files.example/c' }]);
    const op = h.ops.find((o) => o.kind === 'files.download.entry');
    assert.equal(op.maxBytes, 200 * MB);
    assert.ok(op.timeoutMs >= 300_000, `timeoutMs ${op.timeoutMs}`);
    assert.equal(op.overwrite, false);
  } finally {
    h.close();
  }
});

test('overwrite of a small file snapshots it; over 20 MiB skips the snapshot (R7)', async () => {
  const h = makeHarness({
    yolo: 'do-whatever',
    existing: { '/in/small.txt': 100, '/in/huge.bin': 21 * MB },
  });
  try {
    const result: any = await call(h, [
      { ...inline('/in/small.txt'), overwrite: true },
      { ...inline('/in/huge.bin'), overwrite: true },
      inline('/in/new.txt'),
    ]);
    assert.equal(result.succeeded, 3);
    assert.deepEqual(h.snapshots, ['/in/small.txt']);
    assert.equal(result.results[0].recoverable, true);
    assert.equal(result.results[1].recoverable, false);
    const byPath = new Map(h.mutations.map((m) => [m.logicalPath, m]));
    assert.equal(byPath.get('/in/small.txt').snapshotPath !== undefined, true);
    assert.equal(byPath.get('/in/huge.bin').snapshotPath, undefined);
    assert.equal(byPath.get('/in/new.txt').metadata.kind, 'create');
  } finally {
    h.close();
  }
});

test('malformed batches are INVALID_REQUEST before anything runs', async () => {
  const h = makeHarness({ yolo: 'do-whatever' });
  try {
    const bad: unknown[][] = [
      [],
      Array.from({ length: 65 }, (_, i) => inline(`/in/${i}.txt`)),
      [inline('/in/a.txt'), inline('/in/a.txt')],
      [{ path: '/in/a.txt', mimeType: 'text/plain' }],
      [{ ...inline('/in/a.txt'), url: 'https://files.example/a' }],
      [{ path: '/in/a.txt', mimeType: 'text/plain', url: 'ftp://files.example/a' }],
      [{ path: '/in/a.txt', content: b64('x'), encoding: 'base64' }],
    ];
    for (const entries of bad) {
      await assert.rejects(
        () => call(h, entries),
        (e: any) => e.code === 'INVALID_REQUEST',
        JSON.stringify(entries).slice(0, 80),
      );
    }
    assert.equal(h.ops.length, 0);
  } finally {
    h.close();
  }
});

test('the tool honours Settings > Tools switches', async () => {
  const h = makeHarness({ yolo: 'do-whatever', disabled: ['files_download'] });
  try {
    await assert.rejects(
      () => call(h, [inline('/in/a.txt')]),
      (e: any) => e.code === 'TOOL_DISABLED',
    );
  } finally {
    h.close();
  }
});

test('overwrite of a path that does not exist yet works when the executor says ENOENT', async () => {
  const h = makeHarness({ yolo: 'do-whatever', missingCode: 'ENOENT' });
  try {
    const result: any = await call(h, [{ ...inline('/in/new.txt'), overwrite: true }]);
    assert.equal(result.succeeded, 1);
  } finally {
    h.close();
  }
});

test('a remembered DENY on network blocks a batch with a url entry, not an inline one', async () => {
  const h = makeHarness({ yolo: 'do-whatever', deny: ['network'] });
  try {
    await assert.rejects(
      call(h, [
        { path: '/in/u.bin', mimeType: 'application/octet-stream', url: 'https://example.com/f' },
      ]),
      /denied by rule/,
    );
    const ok: any = await call(h, [inline('/in/a.txt')]);
    assert.equal(ok.succeeded, 1);
  } finally {
    h.close();
  }
});
