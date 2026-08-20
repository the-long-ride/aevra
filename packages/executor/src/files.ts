import { createHash } from 'node:crypto';
import { readdir, readFile, stat, writeFile, mkdir, rename, rm, open } from 'node:fs/promises';
import path from 'node:path';
import type { CapabilityRoot } from '../../protocol/src/index.js';
import { resolveCapabilityPath } from '../../security/src/path-policy.js';
import {
  assertRemoteSecretAllowed,
  classifySensitivity,
  maskSensitiveFile,
} from '../../security/src/sensitive.js';

export const MAX_FULL_FILE_BYTES = 16 * 1024 * 1024;
export const MAX_RANGE_READ_BYTES = 1024 * 1024;

export function sha256(data: Buffer | string) {
  return `sha256:${createHash('sha256').update(data).digest('hex')}` as const;
}

function rangeHash(data: Buffer) {
  return createHash('sha256').update(data).digest('hex');
}

export async function fileList(logicalPath: string, roots: CapabilityRoot[]) {
  const r = await resolveCapabilityPath(logicalPath, roots, 'read');
  const entries = await readdir(r.canonicalHostPath, { withFileTypes: true });
  return entries.map((e) => ({
    name: e.name,
    type: e.isDirectory()
      ? 'directory'
      : e.isFile()
        ? 'file'
        : e.isSymbolicLink()
          ? 'link'
          : 'other',
  }));
}

export async function fileRead(
  logicalPath: string,
  roots: CapabilityRoot[],
  range?: { offset?: number; length?: number },
) {
  const r = await resolveCapabilityPath(logicalPath, roots, 'read');
  assertRemoteSecretAllowed(r.logicalPath);
  const info = await stat(r.canonicalHostPath);
  const ranged = range?.offset !== undefined || range?.length !== undefined;
  if (ranged) {
    const offset = Math.max(0, Math.floor(Number(range?.offset ?? 0) || 0));
    const requestedLength = Math.max(
      0,
      Math.floor(Number(range?.length ?? MAX_RANGE_READ_BYTES) || 0),
    );
    const length = Math.min(requestedLength, MAX_RANGE_READ_BYTES, Math.max(0, info.size - offset));
    const buffer = Buffer.alloc(length);
    const handle = await open(r.canonicalHostPath, 'r');
    try {
      const { bytesRead } = await handle.read(buffer, 0, length, offset);
      const chunk = buffer.subarray(0, bytesRead);
      return {
        path: r.logicalPath,
        hash: rangeHash(chunk),
        content: chunk.toString('utf8'),
        offset,
        length: bytesRead,
        totalLength: info.size,
      };
    } finally {
      await handle.close();
    }
  }
  if (info.size > MAX_FULL_FILE_BYTES) {
    throw new Error(
      `File exceeds the ${MAX_FULL_FILE_BYTES}-byte full-read limit; use offset/length ranged reads`,
    );
  }
  const b = await readFile(r.canonicalHostPath);
  return { path: r.logicalPath, hash: sha256(b), content: b.toString('utf8') };
}

export async function fileSearch(
  logicalPath: string,
  query: string,
  roots: CapabilityRoot[],
  max = 100,
) {
  const r = await resolveCapabilityPath(logicalPath, roots, 'read');
  const hits: Array<{ path: string; line: number; text: string }> = [];
  async function walk(dir: string, logical: string) {
    if (hits.length >= max) return;
    for (const e of await readdir(dir, { withFileTypes: true })) {
      if (hits.length >= max) return;
      const full = path.join(dir, e.name),
        lp = (logical + '/' + e.name).replace(/\/+/g, '/');
      if (e.isDirectory()) {
        await walk(full, lp);
        continue;
      }
      if (!e.isFile() || (await stat(full)).size >= 1024 * 1024) continue;
      const sensitivity = classifySensitivity({ path: lp });
      if (sensitivity === 'SECRET') continue;
      let s: string;
      try {
        s = await readFile(full, 'utf8');
      } catch {
        continue;
      }
      for (const [i, line] of s.split(/\r?\n/).entries()) {
        if (!line.includes(query)) continue;
        const safeLine = sensitivity === 'SENSITIVE' ? maskSensitiveFile(lp, line) : line;
        hits.push({ path: lp, line: i + 1, text: safeLine.slice(0, 400) });
        if (hits.length >= max) return;
      }
    }
  }
  await walk(r.canonicalHostPath, r.logicalPath.replace(/\/$/, ''));
  return hits;
}

export async function fileCreate(
  logicalPath: string,
  content: string,
  roots: CapabilityRoot[],
  encoding: 'utf8' | 'base64' = 'utf8',
) {
  const r = await resolveCapabilityPath(logicalPath, roots, 'write');
  assertRemoteSecretAllowed(r.logicalPath);
  await mkdir(path.dirname(r.canonicalHostPath), { recursive: true });
  await writeFile(
    r.canonicalHostPath,
    encoding === 'base64' ? Buffer.from(content, 'base64') : content,
    { flag: 'wx' },
  );
  const b = await readFile(r.canonicalHostPath);
  return { path: r.logicalPath, hash: sha256(b) };
}

export async function fileWrite(
  logicalPath: string,
  content: string,
  roots: CapabilityRoot[],
  encoding: 'utf8' | 'base64' = 'utf8',
) {
  const r = await resolveCapabilityPath(logicalPath, roots, 'write');
  assertRemoteSecretAllowed(r.logicalPath);
  await mkdir(path.dirname(r.canonicalHostPath), { recursive: true });
  const tmp = `${r.canonicalHostPath}.aevra-${process.pid}-${Date.now()}.tmp`;
  await writeFile(tmp, encoding === 'base64' ? Buffer.from(content, 'base64') : content);
  await rename(tmp, r.canonicalHostPath);
  const b = await readFile(r.canonicalHostPath);
  return { path: r.logicalPath, hash: sha256(b) };
}

export async function fileMove(from: string, to: string, roots: CapabilityRoot[]) {
  const a = await resolveCapabilityPath(from, roots, 'write'),
    b = await resolveCapabilityPath(to, roots, 'write');
  assertRemoteSecretAllowed(a.logicalPath);
  assertRemoteSecretAllowed(b.logicalPath);
  await mkdir(path.dirname(b.canonicalHostPath), { recursive: true });
  await rename(a.canonicalHostPath, b.canonicalHostPath);
  return { from: a.logicalPath, to: b.logicalPath };
}

export async function fileDelete(logicalPath: string, recursive: boolean, roots: CapabilityRoot[]) {
  const r = await resolveCapabilityPath(logicalPath, roots, 'write');
  assertRemoteSecretAllowed(r.logicalPath);
  await rm(r.canonicalHostPath, { recursive, force: false });
  return { path: r.logicalPath, deleted: true };
}
