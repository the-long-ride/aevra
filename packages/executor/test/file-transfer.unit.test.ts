import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { CapabilityRoot } from '../../protocol/src/index.js';
import { downloadEntry, uploadRead, uploadStat } from '../src/file-transfer.js';
import type { safeFetch } from '../src/safe-fetch.js';

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'aevra-transfer-'));
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

async function* chunks(...parts: Array<Buffer | string>) {
  for (const part of parts) yield Uint8Array.from(Buffer.from(part));
}

const sha = (data: Buffer | string) => `sha256:${createHash('sha256').update(data).digest('hex')}`;

const PDF = Buffer.from('%PDF-1.7\nbody words');

function entry(over: Record<string, unknown> = {}) {
  return {
    kind: 'files.download.entry' as const,
    path: '/out/a.bin',
    mimeType: 'application/pdf',
    overwrite: false,
    source: { type: 'inline' as const },
    maxBytes: 50_000_000,
    timeoutMs: 10_000,
    ...over,
  };
}

function leftovers(root: string) {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      if (name.isDirectory()) walk(path.join(dir, name.name));
      else if (name.name.endsWith('.tmp')) found.push(name.name);
    }
  };
  walk(root);
  return found;
}

test('inline bytes are written atomically with hash, size and sniffed type', async () => {
  const f = fixture();
  try {
    const result = await downloadEntry(entry(), f.roots, {
      upload: chunks(PDF.subarray(0, 5), PDF.subarray(5)),
    });
    assert.deepEqual(result, {
      path: '/out/a.bin',
      bytes: PDF.length,
      sha256: sha(PDF),
      mimeType: 'application/pdf',
      mimeMismatch: false,
      recoverable: true,
    });
    assert.deepEqual(readFileSync(path.join(f.root, 'out', 'a.bin')), PDF);
    assert.deepEqual(leftovers(f.root), []);
  } finally {
    f.cleanup();
  }
});

test('a declared type that disagrees with the bytes is flagged and the sniffed type wins', async () => {
  const f = fixture();
  try {
    const result = (await downloadEntry(entry({ mimeType: 'image/png' }), f.roots, {
      upload: chunks(PDF),
    })) as any;
    assert.equal(result.mimeMismatch, true);
    assert.equal(result.mimeType, 'application/pdf');
    const plain = (await downloadEntry(
      entry({ path: '/out/b.txt', mimeType: 'text/plain' }),
      f.roots,
      { upload: chunks('just words') },
    )) as any;
    assert.equal(plain.mimeMismatch, false);
    assert.equal(plain.mimeType, 'text/plain');
  } finally {
    f.cleanup();
  }
});

test('an existing target without overwrite is refused and left untouched', async () => {
  const f = fixture();
  try {
    mkdirSync(path.join(f.root, 'out'));
    writeFileSync(path.join(f.root, 'out', 'a.bin'), 'original words');
    await assert.rejects(
      () => downloadEntry(entry(), f.roots, { upload: chunks(PDF) }),
      (e: any) => e.code === 'FILE_EXISTS',
    );
    assert.equal(readFileSync(path.join(f.root, 'out', 'a.bin'), 'utf8'), 'original words');
    assert.deepEqual(leftovers(f.root), []);
  } finally {
    f.cleanup();
  }
});

test('overwrite replaces the file; recoverable is false beyond the snapshot ceiling', async () => {
  const f = fixture();
  try {
    mkdirSync(path.join(f.root, 'out'));
    writeFileSync(path.join(f.root, 'out', 'a.bin'), 'small old words');
    const small = (await downloadEntry(entry({ overwrite: true }), f.roots, {
      upload: chunks(PDF),
    })) as any;
    assert.equal(small.recoverable, true);
    assert.deepEqual(readFileSync(path.join(f.root, 'out', 'a.bin')), PDF);
    writeFileSync(path.join(f.root, 'out', 'a.bin'), Buffer.alloc(21 * 1024 * 1024, 1));
    const large = (await downloadEntry(entry({ overwrite: true }), f.roots, {
      upload: chunks(PDF),
    })) as any;
    assert.equal(large.recoverable, false);
    assert.deepEqual(readFileSync(path.join(f.root, 'out', 'a.bin')), PDF);
  } finally {
    f.cleanup();
  }
});

test('abort leaves no temp', async () => {
  const f = fixture();
  try {
    await assert.rejects(
      () => downloadEntry(entry({ maxBytes: 8 }), f.roots, { upload: chunks(PDF) }),
      (e: any) => e.code === 'SIZE_LIMIT',
    );
    async function* failing() {
      yield Uint8Array.from(PDF);
      throw Object.assign(new Error('stream broke'), { code: 'STREAM_CANCELLED' });
    }
    await assert.rejects(
      () => downloadEntry(entry(), f.roots, { upload: failing() }),
      (e: any) => e.code === 'STREAM_CANCELLED',
    );
    const fetchImpl = (async () => ({
      status: 200,
      contentType: 'application/pdf',
      body: failing(),
    })) as unknown as typeof safeFetch;
    await assert.rejects(
      () =>
        downloadEntry(
          entry({ source: { type: 'url', url: 'https://example.test/a' } }),
          f.roots,
          {},
          {
            fetch: fetchImpl,
          },
        ),
      (e: any) => e.code === 'STREAM_CANCELLED',
    );
    assert.deepEqual(leftovers(f.root), []);
    assert.deepEqual(readdirSync(path.join(f.root, 'out')), []);
  } finally {
    f.cleanup();
  }
});

test('url sources go through safeFetch with the agent headers and limits', async () => {
  const f = fixture();
  try {
    let seen: any;
    const fetchImpl = (async (url: string, options: any) => {
      seen = { url, options };
      return { status: 200, contentType: 'application/pdf', body: chunks(PDF) };
    }) as unknown as typeof safeFetch;
    const result = (await downloadEntry(
      entry({
        source: {
          type: 'url',
          url: 'https://example.test/a.pdf',
          headers: { 'x-sample': 'sample header value' },
        },
        maxBytes: 1234,
        timeoutMs: 4321,
      }),
      f.roots,
      {},
      { fetch: fetchImpl },
    )) as any;
    assert.equal(seen.url, 'https://example.test/a.pdf');
    assert.deepEqual(seen.options.headers, { 'x-sample': 'sample header value' });
    assert.equal(seen.options.maxBytes, 1234);
    assert.equal(seen.options.timeoutMs, 4321);
    assert.equal(seen.options.maxRedirects, 5);
    assert.equal(result.sha256, sha(PDF));
    assert.equal(JSON.stringify(result).includes('sample header value'), false);
    const notFound = (async () => ({
      status: 404,
      body: chunks('nope'),
    })) as unknown as typeof safeFetch;
    await assert.rejects(
      () =>
        downloadEntry(
          entry({ path: '/out/c.bin', source: { type: 'url', url: 'https://example.test/x' } }),
          f.roots,
          {},
          { fetch: notFound },
        ),
      (e: any) => e.code === 'INVALID_REQUEST' && !String(e.message).includes('sample header'),
    );
    assert.deepEqual(leftovers(f.root), []);
  } finally {
    f.cleanup();
  }
});

test('a missing inline stream and a secret target are refused', async () => {
  const f = fixture();
  try {
    await assert.rejects(
      () => downloadEntry(entry(), f.roots, {}),
      (e: any) => e.code === 'INVALID_REQUEST',
    );
    await assert.rejects(
      () => downloadEntry(entry({ path: '/out/.env' }), f.roots, { upload: chunks('plain words') }),
      (e: any) => e.code === 'CAPABILITY_REQUIRED',
    );
    assert.deepEqual(leftovers(f.root), []);
  } finally {
    f.cleanup();
  }
});

test('upload stat reports size, hash, mtime and sniffed type', async () => {
  const f = fixture();
  try {
    writeFileSync(path.join(f.root, 'doc.pdf'), PDF);
    writeFileSync(path.join(f.root, 'notes.txt'), 'plain words');
    const stat = await uploadStat('/doc.pdf', f.roots);
    assert.equal(stat.bytes, PDF.length);
    assert.equal(stat.sha256, sha(PDF));
    assert.equal(stat.mimeType, 'application/pdf');
    assert.equal(typeof stat.mtimeMs, 'number');
    assert.equal((await uploadStat('/notes.txt', f.roots)).mimeType, null);
  } finally {
    f.cleanup();
  }
});

test('upload of a secret file is refused for stat and read', async () => {
  const f = fixture();
  try {
    writeFileSync(path.join(f.root, '.env'), 'plain words');
    await assert.rejects(
      () => uploadStat('/.env', f.roots),
      (e: any) => e.code === 'CAPABILITY_REQUIRED',
    );
    const sent: Uint8Array[] = [];
    await assert.rejects(
      () => uploadRead('/.env', sha('plain words'), f.roots, async (c) => void sent.push(c)),
      (e: any) => e.code === 'CAPABILITY_REQUIRED',
    );
    assert.equal(sent.length, 0);
  } finally {
    f.cleanup();
  }
});

test('upload read streams the bytes and refuses a changed file before sending', async () => {
  const f = fixture();
  try {
    const big = Buffer.alloc(700_000, 3);
    writeFileSync(path.join(f.root, 'big.bin'), big);
    const sent: Buffer[] = [];
    const result = await uploadRead('/big.bin', sha(big), f.roots, async (c) => {
      sent.push(Buffer.from(c));
    });
    assert.deepEqual(Buffer.concat(sent), big);
    assert.deepEqual(result, { bytes: big.length, sha256: sha(big) });
    assert.ok(sent.length >= 2);
    // The bare hex form is accepted too.
    await uploadRead('/big.bin', sha(big).slice('sha256:'.length), f.roots, async () => {});

    writeFileSync(path.join(f.root, 'big.bin'), 'changed words');
    const after: Uint8Array[] = [];
    await assert.rejects(
      () => uploadRead('/big.bin', sha(big), f.roots, async (c) => void after.push(c)),
      (e: any) => e.code === 'FILE_CHANGED',
    );
    assert.equal(after.length, 0);
  } finally {
    f.cleanup();
  }
});
