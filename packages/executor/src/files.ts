import { createHash } from 'node:crypto';
import { readdir, readFile, stat, writeFile, mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import type { CapabilityRoot } from '../../protocol/src/index.js';
import { resolveCapabilityPath } from '../../security/src/path-policy.js';
export function sha256(data: Buffer | string) {
  return `sha256:${createHash('sha256').update(data).digest('hex')}` as const;
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
export async function fileRead(logicalPath: string, roots: CapabilityRoot[]) {
  const r = await resolveCapabilityPath(logicalPath, roots, 'read');
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
      if (e.isDirectory()) await walk(full, lp);
      else if (e.isFile() && (await stat(full)).size < 1024 * 1024) {
        let s;
        try {
          s = await readFile(full, 'utf8');
        } catch {
          continue;
        }
        for (const [i, line] of s.split(/\r?\n/).entries())
          if (line.includes(query)) {
            hits.push({ path: lp, line: i + 1, text: line.slice(0, 400) });
            if (hits.length >= max) return;
          }
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
  await mkdir(path.dirname(b.canonicalHostPath), { recursive: true });
  await rename(a.canonicalHostPath, b.canonicalHostPath);
  return { from: a.logicalPath, to: b.logicalPath };
}
export async function fileDelete(logicalPath: string, recursive: boolean, roots: CapabilityRoot[]) {
  const r = await resolveCapabilityPath(logicalPath, roots, 'write');
  await rm(r.canonicalHostPath, { recursive, force: false });
  return { path: r.logicalPath, deleted: true };
}
