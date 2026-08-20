import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, readFile, stat, writeFile, mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import type { CapabilityRoot } from '../../protocol/src/index.js';
import { resolveCapabilityPath } from '../../security/src/path-policy.js';
import {
  classifySensitivity,
  maskSensitiveFile,
  maxSensitivity,
  type Sensitivity,
} from '../../security/src/sensitive.js';

export const MAX_FULL_FILE_BYTES = 16 * 1024 * 1024;
export const MAX_RANGE_READ_CHARACTERS = 1024 * 1024;
export const MAX_RANGE_READ_BYTES = MAX_RANGE_READ_CHARACTERS;

export function sha256(data: Buffer | string) {
  return `sha256:${createHash('sha256').update(data).digest('hex')}` as const;
}

function rangeHash(data: Buffer | string) {
  return createHash('sha256').update(data).digest('hex');
}

function denySecret(pathValue: string): never {
  throw Object.assign(new Error(`Protected secret resource cannot be accessed remotely: ${pathValue}`), {
    code: 'CAPABILITY_REQUIRED',
  });
}

function inodeKey(info: { dev: number; ino: number }) {
  return `${info.dev}:${info.ino}`;
}

function logicalForRoot(root: CapabilityRoot, fullPath: string) {
  const relative = path.relative(root.hostRoot, fullPath).split(path.sep).join('/');
  const prefix = ('/' + root.logicalPrefix.replaceAll('\\', '/')).replace(/\/+/g, '/').replace(/\/$/, '');
  return `${prefix === '/' ? '' : prefix}/${relative}`.replace(/\/+/g, '/') || '/';
}

async function buildHardLinkSensitivityIndex(roots: CapabilityRoot[]) {
  const index = new Map<string, Sensitivity>();
  for (const root of roots) {
    const walk = async (dir: string) => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
          continue;
        }
        if (!entry.isFile()) continue;
        let info;
        try {
          info = await stat(full);
        } catch {
          continue;
        }
        if (info.nlink <= 1) continue;
        const key = inodeKey(info);
        const sensitivity = classifySensitivity({ path: logicalForRoot(root, full) });
        index.set(key, maxSensitivity(index.get(key) ?? 'NORMAL', sensitivity));
      }
    };
    await walk(root.hostRoot);
  }
  return index;
}

async function effectiveSensitivity(
  logicalPath: string,
  canonicalHostPath: string,
  roots: CapabilityRoot[],
  info?: { dev: number; ino: number; nlink: number } | null,
  hardLinkIndex?: Map<string, Sensitivity>,
) {
  let sensitivity = maxSensitivity(
    classifySensitivity({ path: logicalPath }),
    classifySensitivity({ path: canonicalHostPath }),
  );
  if (info && info.nlink > 1) {
    const index = hardLinkIndex ?? (await buildHardLinkSensitivityIndex(roots));
    sensitivity = maxSensitivity(sensitivity, index.get(inodeKey(info)) ?? 'NORMAL');
  }
  return sensitivity;
}

async function existingInfo(file: string) {
  try {
    return await stat(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function assertMutationAllowed(
  logicalPath: string,
  canonicalHostPath: string,
  roots: CapabilityRoot[],
) {
  const requested = classifySensitivity({ path: logicalPath });
  const info = await existingInfo(canonicalHostPath);
  const effective = await effectiveSensitivity(logicalPath, canonicalHostPath, roots, info);
  if (effective === 'SECRET') denySecret(logicalPath);
  if (effective === 'SENSITIVE' && requested === 'NORMAL') {
    throw Object.assign(
      new Error(`Sensitive alias requires its classified path and one-time approval: ${logicalPath}`),
      { code: 'CAPABILITY_REQUIRED' },
    );
  }
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

export async function fileList(logicalPath: string, roots: CapabilityRoot[]) {
  const r = await resolveCapabilityPath(logicalPath, roots, 'read');
  const entries = await readdir(r.canonicalHostPath, { withFileTypes: true });
  return entries.map((entry) => ({
    name: entry.name,
    type: entry.isDirectory()
      ? 'directory'
      : entry.isFile()
        ? 'file'
        : entry.isSymbolicLink()
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
  const info = await stat(r.canonicalHostPath);
  const sensitivity = await effectiveSensitivity(r.logicalPath, r.canonicalHostPath, roots, info);
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
) {
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
      if (info.nlink > 1) hardLinks ??= buildHardLinkSensitivityIndex(roots);
      const sensitivity = await effectiveSensitivity(
        candidateLogical,
        full,
        roots,
        info,
        hardLinks ? await hardLinks : undefined,
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
  return hits;
}

export async function fileCreate(
  logicalPath: string,
  content: string,
  roots: CapabilityRoot[],
  encoding: 'utf8' | 'base64' = 'utf8',
) {
  const r = await resolveCapabilityPath(logicalPath, roots, 'write');
  await assertMutationAllowed(r.logicalPath, r.canonicalHostPath, roots);
  await mkdir(path.dirname(r.canonicalHostPath), { recursive: true });
  await writeFile(
    r.canonicalHostPath,
    encoding === 'base64' ? Buffer.from(content, 'base64') : content,
    { flag: 'wx' },
  );
  const buffer = await readFile(r.canonicalHostPath);
  return { path: r.logicalPath, hash: sha256(buffer) };
}

export async function fileWrite(
  logicalPath: string,
  content: string,
  roots: CapabilityRoot[],
  encoding: 'utf8' | 'base64' = 'utf8',
) {
  const r = await resolveCapabilityPath(logicalPath, roots, 'write');
  await assertMutationAllowed(r.logicalPath, r.canonicalHostPath, roots);
  await mkdir(path.dirname(r.canonicalHostPath), { recursive: true });
  const temp = `${r.canonicalHostPath}.aevra-${process.pid}-${Date.now()}.tmp`;
  await writeFile(temp, encoding === 'base64' ? Buffer.from(content, 'base64') : content);
  await rename(temp, r.canonicalHostPath);
  const buffer = await readFile(r.canonicalHostPath);
  return { path: r.logicalPath, hash: sha256(buffer) };
}

export async function fileMove(from: string, to: string, roots: CapabilityRoot[]) {
  const source = await resolveCapabilityPath(from, roots, 'write');
  const target = await resolveCapabilityPath(to, roots, 'write');
  await assertMutationAllowed(source.logicalPath, source.canonicalHostPath, roots);
  await assertMutationAllowed(target.logicalPath, target.canonicalHostPath, roots);
  await mkdir(path.dirname(target.canonicalHostPath), { recursive: true });
  await rename(source.canonicalHostPath, target.canonicalHostPath);
  return { from: source.logicalPath, to: target.logicalPath };
}

export async function fileDelete(logicalPath: string, recursive: boolean, roots: CapabilityRoot[]) {
  const r = await resolveCapabilityPath(logicalPath, roots, 'write');
  await assertMutationAllowed(r.logicalPath, r.canonicalHostPath, roots);
  await rm(r.canonicalHostPath, { recursive, force: false });
  return { path: r.logicalPath, deleted: true };
}
