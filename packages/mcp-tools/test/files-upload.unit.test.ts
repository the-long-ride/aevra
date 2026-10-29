import assert from 'node:assert/strict';
import test from 'node:test';
import { toolDefinitions } from '../src/registry.js';
import { makeHarness, MB, sha } from './transfer-harness.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const BASE = 'https://aevra.example';

const call = (h: ReturnType<typeof makeHarness>, paths: string[], delivery?: string) =>
  h.service.call('s1', 'files_upload', {
    workspaceId: 'w1',
    paths,
    ...(delivery ? { delivery } : {}),
  });

test('files_upload advertises a closed schema and is not read-only', () => {
  const tool = toolDefinitions().find((t) => t.name === 'files_upload')!;
  assert.ok(tool);
  assert.equal(tool.annotations.readOnlyHint, false);
  assert.equal(tool.annotations.openWorldHint, true);
  const schema = tool.inputSchema as any;
  assert.deepEqual(schema.required, ['paths']);
  assert.equal(schema.properties.paths.minItems, 1);
  assert.equal(schema.properties.paths.maxItems, 64);
  assert.deepEqual(schema.properties.delivery.enum, ['auto', 'inline', 'link']);
  assert.equal(schema.additionalProperties, false);
});

test('a small png comes back inline with the right sha256', async () => {
  const h = makeHarness({
    yolo: 'do-whatever',
    readable: { '/img/a.png': { data: PNG, mimeType: 'image/png' } },
  });
  try {
    const result: any = await call(h, ['/img/a.png']);
    assert.equal(result.ok, true);
    assert.equal(result.succeeded, 1);
    const entry = result.results[0];
    assert.equal(entry.delivery, 'inline');
    assert.equal(entry.mimeType, 'image/png');
    assert.equal(entry.bytes, PNG.length);
    assert.equal(entry.sha256, sha(PNG));
    assert.equal(entry.content, PNG.toString('base64'));
    assert.equal(h.requests.length, 0);
  } finally {
    h.close();
  }
});

test('mime type falls back to the extension, then to octet-stream', async () => {
  const h = makeHarness({
    yolo: 'do-whatever',
    readable: {
      '/a/notes.txt': { data: Buffer.from('plain words') },
      '/a/blob.zzz': { data: Buffer.from('more words') },
    },
  });
  try {
    const result: any = await call(h, ['/a/notes.txt', '/a/blob.zzz']);
    assert.equal(result.results[0].mimeType, 'text/plain');
    assert.equal(result.results[1].mimeType, 'application/octet-stream');
  } finally {
    h.close();
  }
});

test('a call asks for one HIGH files.read approval, then resumes with the bytes', async () => {
  const h = makeHarness({ readable: { '/img/a.png': { data: PNG, mimeType: 'image/png' } } });
  try {
    const pending: any = await call(h, ['/img/a.png']);
    assert.equal(pending.status, 'approval_pending');
    assert.equal(h.requests.length, 1);
    const op = h.requests[0].operation;
    assert.equal(op.family, 'files:transfer');
    assert.equal(op.capability, 'files.read');
    assert.equal(op.risk, 'HIGH');
    assert.equal(h.ops.length, 0);
    h.approvals.approve(pending.requestId, 'once');
    const done: any = await h.service.call('s1', 'approval_wait', { requestId: pending.requestId });
    assert.equal(done.succeeded, 1);
    assert.equal(done.results[0].content, PNG.toString('base64'));
    const stored = h.db
      .raw()
      .prepare('SELECT operation_json FROM pending_approvals')
      .all() as any[];
    assert.ok(!JSON.stringify(stored).includes(PNG.toString('base64')));
  } finally {
    h.close();
  }
});

test('prevent-high-risk YOLO still asks (R1)', async () => {
  const h = makeHarness({
    yolo: 'prevent-high-risk',
    readable: { '/img/a.png': { data: PNG } },
  });
  try {
    const pending: any = await call(h, ['/img/a.png']);
    assert.equal(pending.status, 'approval_pending');
  } finally {
    h.close();
  }
});

test('auto over 4 MB mints a link; the link serves exactly that file', async () => {
  const big = Buffer.alloc(5 * MB, 7);
  const h = makeHarness({
    yolo: 'do-whatever',
    publicUrl: BASE,
    readable: { '/data/big.bin': { data: big }, '/data/small.txt': { data: Buffer.from('hi') } },
  });
  try {
    const result: any = await call(h, ['/data/big.bin', '/data/small.txt']);
    assert.equal(result.succeeded, 2);
    for (const entry of result.results) {
      assert.equal(entry.delivery, 'link');
      assert.equal(entry.content, undefined);
      assert.ok(entry.url.startsWith(`${BASE}/files/`));
      assert.ok(Date.parse(entry.expiresAt) > Date.now());
    }
    const secret = result.results[0].url.slice(`${BASE}/files/`.length);
    const record = h.links.claim(secret);
    assert.equal(record?.path, '/data/big.bin');
    assert.equal(record?.bytes, big.length);
    assert.equal(record?.sha256, sha(big));
  } finally {
    h.close();
  }
});

test('explicit link works for a small file; inline forced stays inline', async () => {
  const h = makeHarness({
    yolo: 'do-whatever',
    publicUrl: BASE,
    readable: { '/a.txt': { data: Buffer.from('words') } },
  });
  try {
    const link: any = await call(h, ['/a.txt'], 'link');
    assert.equal(link.results[0].delivery, 'link');
    const inline: any = await call(h, ['/a.txt'], 'inline');
    assert.equal(inline.results[0].delivery, 'inline');
  } finally {
    h.close();
  }
});

test('no public url -> PUBLIC_URL_REQUIRED for link and over-threshold auto', async () => {
  const big = Buffer.alloc(5 * MB, 1);
  const h = makeHarness({
    yolo: 'do-whatever',
    readable: { '/big.bin': { data: big }, '/a.txt': { data: Buffer.from('words') } },
  });
  try {
    const forced: any = await call(h, ['/a.txt'], 'link');
    assert.equal(forced.results[0].error.code, 'PUBLIC_URL_REQUIRED');
    const auto: any = await call(h, ['/big.bin']);
    assert.equal(auto.results[0].error.code, 'PUBLIC_URL_REQUIRED');
    const small: any = await call(h, ['/a.txt']);
    assert.equal(small.results[0].delivery, 'inline');
  } finally {
    h.close();
  }
});

test('inline over the inline limit is INLINE_TOO_LARGE per entry', async () => {
  const h = makeHarness({
    yolo: 'do-whatever',
    limits: { maxFileMb: 200, maxBatchMb: 500, inlineMb: 1 },
    readable: {
      '/one.bin': { data: Buffer.alloc(700 * 1024, 1) },
      '/two.bin': { data: Buffer.alloc(700 * 1024, 2) },
    },
  });
  try {
    const result: any = await call(h, ['/one.bin', '/two.bin'], 'inline');
    assert.equal(result.results[0].ok, true);
    assert.equal(result.results[1].error.code, 'INLINE_TOO_LARGE');
    assert.equal(result.failed, 1);
  } finally {
    h.close();
  }
});

test('a file over the per-file limit is SIZE_LIMIT', async () => {
  const h = makeHarness({
    yolo: 'do-whatever',
    publicUrl: BASE,
    limits: { maxFileMb: 1, maxBatchMb: 500, inlineMb: 50 },
    readable: { '/big.bin': { data: Buffer.alloc(2 * MB, 1) } },
  });
  try {
    const result: any = await call(h, ['/big.bin']);
    assert.equal(result.results[0].error.code, 'SIZE_LIMIT');
  } finally {
    h.close();
  }
});

test('a secret file is refused and never reaches the worker', async () => {
  const h = makeHarness({
    yolo: 'do-whatever',
    readable: { '/proj/.env': { data: Buffer.from('plain words') } },
  });
  try {
    const result: any = await call(h, ['/proj/.env']);
    assert.equal(result.results[0].ok, false);
    assert.equal(result.results[0].error.code, 'CAPABILITY_REQUIRED');
    assert.equal(h.ops.length, 0);
    assert.equal(h.links.claim('x'.repeat(43)), null);
  } finally {
    h.close();
  }
});

test('a missing file fails alone; the others still come back', async () => {
  const h = makeHarness({
    yolo: 'do-whatever',
    readable: { '/a.txt': { data: Buffer.from('w') } },
  });
  try {
    const result: any = await call(h, ['/nope.txt', '/a.txt']);
    assert.equal(result.ok, false);
    assert.equal(result.results[0].error.code, 'NOT_FOUND');
    assert.equal(result.results[1].ok, true);
  } finally {
    h.close();
  }
});

test('a worker that cannot stream gives EXECUTOR_UNAVAILABLE for inline reads', async () => {
  const h = makeHarness({
    yolo: 'do-whatever',
    noDownloadStream: true,
    readable: { '/a.txt': { data: Buffer.from('w') } },
  });
  try {
    const result: any = await call(h, ['/a.txt']);
    assert.equal(result.results[0].error.code, 'EXECUTOR_UNAVAILABLE');
  } finally {
    h.close();
  }
});

test('malformed batches are rejected before anything runs', async () => {
  const h = makeHarness({
    yolo: 'do-whatever',
    readable: { '/a.txt': { data: Buffer.from('w') } },
  });
  try {
    const bad: unknown[] = [
      [],
      Array.from({ length: 65 }, (_, i) => `/f${i}.txt`),
      ['/a.txt', '/a.txt'],
      [''],
      [42],
    ];
    for (const paths of bad) {
      await assert.rejects(
        h.service.call('s1', 'files_upload', { workspaceId: 'w1', paths }),
        (e: any) => e.code === 'INVALID_REQUEST',
      );
    }
    await assert.rejects(
      call(h, ['/a.txt'], 'carrier-pigeon'),
      (e: any) => e.code === 'INVALID_REQUEST',
    );
    assert.equal(h.ops.length, 0);
  } finally {
    h.close();
  }
});

test('a disabled files_upload is refused', async () => {
  const h = makeHarness({ yolo: 'do-whatever', disabled: ['files_upload'] });
  try {
    await assert.rejects(call(h, ['/a.txt']), (e: any) => e.code === 'TOOL_DISABLED');
  } finally {
    h.close();
  }
});

test('an ENOENT from the executor is NOT_FOUND without the raw fs message', async () => {
  const h = makeHarness({ yolo: 'do-whatever', missingCode: 'ENOENT' });
  try {
    const result: any = await call(h, ['/nope.txt']);
    assert.equal(result.results[0].error.code, 'NOT_FOUND');
    assert.ok(!JSON.stringify(result).includes('/host/secret'));
  } finally {
    h.close();
  }
});

test('entries past the per-batch limit fail with BATCH_LIMIT', async () => {
  const h = makeHarness({
    yolo: 'do-whatever',
    limits: { maxFileMb: 2, maxBatchMb: 2, inlineMb: 2 },
    readable: {
      '/a.bin': { data: Buffer.alloc(MB + 1, 1) },
      '/b.bin': { data: Buffer.alloc(MB + 1, 2) },
    },
  });
  try {
    const result: any = await call(h, ['/a.bin', '/b.bin']);
    assert.equal(result.results[0].ok, true);
    assert.equal(result.results[1].error.code, 'BATCH_LIMIT');
  } finally {
    h.close();
  }
});

test('after_tool_call hook never sees the link secret, the agent still gets it', async () => {
  const h = makeHarness({
    yolo: 'do-whatever',
    publicUrl: BASE,
    hook: true,
    hookEvent: 'after_tool_call',
    readable: { '/a.txt': { data: Buffer.from('words') } },
  });
  try {
    const result: any = await call(h, ['/a.txt'], 'link');
    const url: string = result.results[0].url;
    const secret = url.slice(`${BASE}/files/`.length);
    assert.ok(secret.length > 8);
    assert.ok(h.hookPayloads.length >= 1);
    const seen = JSON.stringify(h.hookPayloads);
    assert.ok(!seen.includes(secret));
    assert.ok(seen.includes('[REDACTED]'));
  } finally {
    h.close();
  }
});
