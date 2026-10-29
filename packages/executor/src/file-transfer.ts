import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { link, open, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { FileHandle } from 'node:fs/promises';
import type { CapabilityRoot } from '../../protocol/src/index.js';
import type { ProtectedGlob } from '../../protocol/src/worker.js';
import type { FileTransferOperation } from '../../protocol/src/file-transfer-ops.js';
import { resolveCapabilityPath } from '../../security/src/path-policy.js';
import { assertMutationAllowed, denySecret, effectiveSensitivity } from './file-sensitivity.js';
import { revalidateMutationPath } from './file-mutations.js';
import { ensureParent } from './ensure-parent.js';
import { compileProtectedGlobs } from './protected-globs.js';
import { sniffMime } from './mime-sniff.js';
import { safeFetch } from './safe-fetch.js';

type DownloadEntry = Extract<FileTransferOperation, { kind: 'files.download.entry' }>;

/** Same ceiling the core change-set uses; beyond it an overwritten file is not snapshotted. */
const MAX_SNAPSHOT_BYTES = 20 * 1024 * 1024;
const SNIFF_BYTES = 8192;
const READ_CHUNK = 256 * 1024;
const MAX_REDIRECTS = 5;

let tempSequence = 0;

function coded(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}

/** Same directory as the target; a short hash stands in for the name so it never exceeds NAME_MAX. */
function tempPathFor(target: string) {
  const tag = createHash('sha256').update(path.basename(target)).digest('hex').slice(0, 16);
  return path.join(path.dirname(target), `.aevra-xfer-${tag}-${process.pid}-${++tempSequence}.tmp`);
}

export interface TransferDeps {
  fetch?: typeof safeFetch;
}

async function statOrNull(file: string) {
  try {
    return await stat(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function normalizeHash(value: string) {
  return value.replace(/^sha256:/i, '').toLowerCase();
}

function normalizeMime(value: string) {
  return value.split(';')[0]!.trim().toLowerCase();
}

function mimeDisagrees(sniffed: string | null, declared: string) {
  if (sniffed === null || sniffed === declared) return false;
  if (sniffed === 'image/jpeg' && declared === 'image/jpg') return false;
  const office = 'application/vnd.openxmlformats';
  if (sniffed === 'application/zip' && declared.startsWith(office)) return false;
  if (declared === 'application/zip' && sniffed.startsWith(office)) return false;
  return true;
}

async function writeFully(handle: FileHandle, chunk: Uint8Array) {
  let offset = 0;
  while (offset < chunk.length) {
    const { bytesWritten } = await handle.write(chunk, offset, chunk.length - offset);
    offset += bytesWritten;
  }
}

async function pump(source: AsyncIterable<Uint8Array>, handle: FileHandle, maxBytes: number) {
  const hash = createHash('sha256');
  const head = Buffer.alloc(SNIFF_BYTES);
  let headLength = 0;
  let bytes = 0;
  for await (const chunk of source) {
    bytes += chunk.length;
    if (bytes > maxBytes) throw coded('SIZE_LIMIT', `Content exceeds the ${maxBytes}-byte limit`);
    hash.update(chunk);
    if (headLength < SNIFF_BYTES) {
      headLength += Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength).copy(
        head,
        headLength,
        0,
        SNIFF_BYTES - headLength,
      );
    }
    await writeFully(handle, chunk);
  }
  return { bytes, sha256: `sha256:${hash.digest('hex')}`, head: head.subarray(0, headLength) };
}

async function openSource(
  op: DownloadEntry,
  ctx: { upload?: AsyncIterable<Uint8Array> },
  deps: TransferDeps,
): Promise<{ body: AsyncIterable<Uint8Array>; close?: () => void }> {
  if (op.source.type === 'inline') {
    if (!ctx.upload) throw coded('INVALID_REQUEST', 'Inline content requires an upload stream');
    return { body: ctx.upload };
  }
  const response = await (deps.fetch ?? safeFetch)(op.source.url, {
    ...(op.source.headers ? { headers: op.source.headers } : {}),
    maxBytes: op.maxBytes,
    maxRedirects: MAX_REDIRECTS,
    timeoutMs: op.timeoutMs,
  });
  const close = (response as { close?: () => void }).close?.bind(response);
  if (response.status < 200 || response.status > 299) {
    close?.();
    throw coded('INVALID_REQUEST', `Download source answered HTTP ${response.status}`);
  }
  return { body: response.body, ...(close ? { close } : {}) };
}

/** Moves the finished temp file onto the target; exported so cleanup failures can be tested. */
export async function commitTransfer(
  temp: string,
  target: string,
  overwrite: boolean,
  removeTemp: (path: string) => Promise<void> = (path) => rm(path, { force: true }),
) {
  if (overwrite) {
    await rename(temp, target);
    return;
  }
  // link() fails with EEXIST if anything appeared at the target meanwhile, so a
  // no-overwrite download can never replace a file it did not see.
  try {
    await link(temp, target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw coded('FILE_EXISTS', 'Target already exists and overwrite is false');
    }
    if (await statOrNull(target)) throw coded('FILE_EXISTS', 'Target already exists');
    await rename(temp, target);
    return;
  }
  // The target is written; a temp that cannot be removed must not look like a failed commit.
  await removeTemp(temp).catch(() => undefined);
}

/** Writes one `files_download` entry: temp file in the target directory, then an atomic move. */
export async function downloadEntry(
  op: DownloadEntry,
  roots: CapabilityRoot[],
  ctx: { upload?: AsyncIterable<Uint8Array> },
  deps: TransferDeps = {},
) {
  await ensureParent(op.path, roots);
  const resolved = await resolveCapabilityPath(op.path, roots, 'write');
  await assertMutationAllowed(resolved.logicalPath, resolved.canonicalHostPath, roots);
  const current = await revalidateMutationPath(resolved, roots);
  const target = current.canonicalHostPath;
  const existing = await statOrNull(target);
  if (existing && !existing.isFile()) throw coded('INVALID_REQUEST', 'Target is not a file');
  if (existing && !op.overwrite) throw coded('FILE_EXISTS', 'Target already exists');
  const source = await openSource(op, ctx, deps);
  const temp = tempPathFor(target);
  let created = false;
  try {
    const handle = await open(
      temp,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    created = true;
    let written;
    try {
      written = await pump(source.body, handle, op.maxBytes);
    } finally {
      await handle.close();
    }
    await revalidateMutationPath(current, roots);
    await commitTransfer(temp, target, op.overwrite);
    created = false;
    await revalidateMutationPath(current, roots);
    const sniffed = sniffMime(written.head);
    const declared = normalizeMime(op.mimeType);
    return {
      path: current.logicalPath,
      bytes: written.bytes,
      sha256: written.sha256,
      mimeType: sniffed ?? declared,
      mimeMismatch: mimeDisagrees(sniffed, declared),
      recoverable: !existing || existing.size <= MAX_SNAPSHOT_BYTES,
    };
  } finally {
    source.close?.();
    if (created) {
      try {
        await revalidateMutationPath(current, roots);
        await rm(temp, { force: true });
      } catch {
        /* leave the detached temp rather than follow a replaced parent */
      }
    }
  }
}

/** Binary bytes cannot be masked, so SECRET and SENSITIVE files are both refused outright. */
async function resolveReadable(
  logicalPath: string,
  roots: CapabilityRoot[],
  globs?: ProtectedGlob[],
) {
  const resolved = await resolveCapabilityPath(logicalPath, roots, 'read');
  const info = await stat(resolved.canonicalHostPath);
  if (!info.isFile()) throw coded('INVALID_REQUEST', 'Not a regular file');
  const sensitivity = await effectiveSensitivity(
    resolved.logicalPath,
    resolved.canonicalHostPath,
    roots,
    info,
    undefined,
    compileProtectedGlobs(globs),
  );
  if (sensitivity === 'SECRET' || sensitivity === 'SENSITIVE') denySecret(resolved.logicalPath);
  return resolved;
}

/** Reads the whole file in chunks; returns the byte count seen. */
async function readChunks(handle: FileHandle, onChunk: (chunk: Buffer) => Promise<void>) {
  const buffer = Buffer.allocUnsafe(READ_CHUNK);
  let position = 0;
  for (;;) {
    const { bytesRead } = await handle.read(buffer, 0, READ_CHUNK, position);
    if (bytesRead === 0) return position;
    position += bytesRead;
    // Copy: the caller may hold the chunk (IPC send queues it) while we refill the buffer.
    await onChunk(Buffer.from(buffer.subarray(0, bytesRead)));
  }
}

export async function uploadStat(
  logicalPath: string,
  roots: CapabilityRoot[],
  protectedGlobs?: ProtectedGlob[],
  options: { hash?: boolean } = {},
) {
  const resolved = await resolveReadable(logicalPath, roots, protectedGlobs);
  const handle = await open(resolved.canonicalHostPath, 'r');
  try {
    const info = await handle.stat();
    if (options.hash === false) {
      // Size and type only: read the sniff window, never the whole file.
      const buffer = Buffer.alloc(SNIFF_BYTES);
      const { bytesRead } = await handle.read(buffer, 0, SNIFF_BYTES, 0);
      return {
        bytes: info.size,
        mtimeMs: info.mtimeMs,
        mimeType: sniffMime(buffer.subarray(0, bytesRead)),
      };
    }
    const hash = createHash('sha256');
    let head = Buffer.alloc(0);
    const bytes = await readChunks(handle, async (chunk) => {
      hash.update(chunk);
      if (head.length < SNIFF_BYTES) head = Buffer.concat([head, chunk]).subarray(0, SNIFF_BYTES);
    });
    return {
      bytes,
      sha256: `sha256:${hash.digest('hex')}`,
      mtimeMs: info.mtimeMs,
      mimeType: sniffMime(head),
    };
  } finally {
    await handle.close();
  }
}

/**
 * Streams a file out through `send`. The expected hash is verified over the
 * open handle before the first byte leaves, and again over the bytes actually
 * sent, so a file swapped mid-read still ends in FILE_CHANGED.
 */
export async function uploadRead(
  logicalPath: string,
  expectedSha256: string,
  roots: CapabilityRoot[],
  send: (chunk: Uint8Array) => Promise<void>,
  protectedGlobs?: ProtectedGlob[],
) {
  const resolved = await resolveReadable(logicalPath, roots, protectedGlobs);
  const expected = normalizeHash(expectedSha256);
  const handle = await open(resolved.canonicalHostPath, 'r');
  try {
    const before = createHash('sha256');
    await readChunks(handle, async (chunk) => void before.update(chunk));
    if (before.digest('hex') !== expected) {
      throw coded('FILE_CHANGED', 'File changed since it was inspected');
    }
    const sent = createHash('sha256');
    const bytes = await readChunks(handle, async (chunk) => {
      sent.update(chunk);
      await send(chunk);
    });
    const digest = sent.digest('hex');
    if (digest !== expected) throw coded('FILE_CHANGED', 'File changed while it was being read');
    return { bytes, sha256: `sha256:${digest}` };
  } finally {
    await handle.close();
  }
}
