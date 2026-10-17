import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import type { CapabilityRoot } from '../../protocol/src/index.js';
import type { ProtectedGlob } from '../../protocol/src/worker.js';
import { resolveCapabilityPath } from '../../security/src/path-policy.js';
import { maskSensitiveFile, type Sensitivity } from '../../security/src/sensitive.js';
import { compileProtectedGlobs } from './protected-globs.js';

import {
  denySecret,
  effectiveSensitivity,
  buildHardLinkSensitivityIndex,
} from './file-sensitivity.js';

const MAX_FULL_FILE_BYTES = 16 * 1024 * 1024;
const MAX_RANGE_READ_CHARACTERS = 1024 * 1024;

function sha256(data: Buffer | string) {
  return `sha256:${createHash('sha256').update(data).digest('hex')}` as const;
}

function rangeHash(data: Buffer | string) {
  return createHash('sha256').update(data).digest('hex');
}

async function readUtf8Range(file: string, offset: number, requestedLength: number) {
  const length = Math.min(requestedLength, MAX_RANGE_READ_CHARACTERS);
  const decoder = new StringDecoder('utf8');
  const parts: string[] = [];
  let position = 0;

  const consume = (text: string) => {
    if (!text) return;
    const localStart = Math.max(0, offset - position);
    const localEnd = Math.min(text.length, offset + length - position);
    if (localStart < localEnd) parts.push(text.slice(localStart, localEnd));
    position += text.length;
  };

  for await (const chunk of createReadStream(file)) consume(decoder.write(Buffer.from(chunk)));
  consume(decoder.end());
  const content = parts.join('');
  return { content, offset, length: content.length, totalLength: position };
}

export type FileListEntry = {
  name: string;
  type: 'directory' | 'file' | 'link' | 'other';
};

export async function fileList(
  logicalPath: string,
  roots: CapabilityRoot[],
): Promise<{ entries: FileListEntry[] }> {
  const r = await resolveCapabilityPath(logicalPath, roots, 'read');
  const entries = await readdir(r.canonicalHostPath, { withFileTypes: true });
  return {
    entries: entries.map((entry) => ({
      name: entry.name,
      type: entry.isDirectory()
        ? 'directory'
        : entry.isFile()
          ? 'file'
          : entry.isSymbolicLink()
            ? 'link'
            : 'other',
    })),
  };
}

export async function fileRead(
  logicalPath: string,
  roots: CapabilityRoot[],
  range?: { offset?: number; length?: number },
  protectedGlobs?: ProtectedGlob[],
) {
  const userPatterns = compileProtectedGlobs(protectedGlobs);
  const r = await resolveCapabilityPath(logicalPath, roots, 'read');
  const info = await stat(r.canonicalHostPath);
  const sensitivity = await effectiveSensitivity(
    r.logicalPath,
    r.canonicalHostPath,
    roots,
    info,
    undefined,
    userPatterns,
  );
  if (sensitivity === 'SECRET') denySecret(r.logicalPath);
  const ranged = range?.offset !== undefined || range?.length !== undefined;
  if (ranged) {
    const offset = Math.max(0, Math.floor(Number(range?.offset ?? 0) || 0));
    const requestedLength = Math.max(
      0,
      Math.floor(Number(range?.length ?? MAX_RANGE_READ_CHARACTERS) || 0),
    );
    const chunk = await readUtf8Range(r.canonicalHostPath, offset, requestedLength);
    const content =
      sensitivity === 'SENSITIVE' ? maskSensitiveFile(r.logicalPath, chunk.content) : chunk.content;
    return { path: r.logicalPath, hash: rangeHash(chunk.content), ...chunk, content, sensitivity };
  }
  if (info.size > MAX_FULL_FILE_BYTES) {
    throw new Error(
      `File exceeds the ${MAX_FULL_FILE_BYTES}-byte full-read limit; use offset/length ranged reads`,
    );
  }
  const buffer = await readFile(r.canonicalHostPath);
  const raw = buffer.toString('utf8');
  const content = sensitivity === 'SENSITIVE' ? maskSensitiveFile(r.logicalPath, raw) : raw;
  return { path: r.logicalPath, hash: sha256(buffer), content, sensitivity };
}

export async function fileSearch(
  logicalPath: string,
  query: string,
  roots: CapabilityRoot[],
  max = 100,
  protectedGlobs?: ProtectedGlob[],
) {
  // Compiled once for the whole walk: this classifies every candidate file, so
  // a per-file compile would sit in the inner loop. Without it, a workspace's
  // declared `protectedPaths` covered the authorization of the search ROOT and
  // nothing else, and a declared-SECRET file's contents came back as hits.
  const userPatterns = compileProtectedGlobs(protectedGlobs);
  const r = await resolveCapabilityPath(logicalPath, roots, 'read');
  const hits: Array<{ path: string; line: number; text: string }> = [];
  let hardLinks: Promise<Map<string, Sensitivity>> | undefined;
  async function walk(dir: string, logical: string) {
    if (hits.length >= max) return;
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (hits.length >= max) return;
      const full = path.join(dir, entry.name);
      const candidateLogical = (logical + '/' + entry.name).replace(/\/+/g, '/');
      if (entry.isDirectory()) {
        await walk(full, candidateLogical);
        continue;
      }
      if (!entry.isFile()) continue;
      const info = await stat(full);
      if (info.size >= 1024 * 1024) continue;
      if (info.nlink > 1) hardLinks ??= buildHardLinkSensitivityIndex(roots, userPatterns);
      const sensitivity = await effectiveSensitivity(
        candidateLogical,
        full,
        roots,
        info,
        hardLinks ? await hardLinks : undefined,
        userPatterns,
      );
      if (sensitivity === 'SECRET') continue;
      let source: string;
      try {
        source = await readFile(full, 'utf8');
      } catch {
        continue;
      }
      for (const [index, line] of source.split(/\r?\n/).entries()) {
        if (!line.includes(query)) continue;
        const safeLine =
          sensitivity === 'SENSITIVE' ? maskSensitiveFile(candidateLogical, line) : line;
        hits.push({ path: candidateLogical, line: index + 1, text: safeLine.slice(0, 400) });
        if (hits.length >= max) return;
      }
    }
  }
  await walk(r.canonicalHostPath, r.logicalPath.replace(/\/$/, ''));
  return { hits };
}

export { fileCreate, fileWrite, fileMove, fileDelete } from './file-mutations.js';
