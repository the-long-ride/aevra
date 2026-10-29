import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { normalizeLogicalPath } from './logical-path.js';
import type {
  Capability,
  CapabilityRoot,
  ResolvedCapabilityPath,
} from '../../protocol/src/index.js';
class WorkspaceEscapeError extends Error {
  code = 'WORKSPACE_ESCAPE' as const;
  constructor(public logicalPath: string) {
    super(`Path escapes registered capability roots: ${logicalPath}`);
  }
}
function normalized(p: string) {
  const r = path.resolve(p);
  return process.platform === 'win32' ? r.toLowerCase() : r;
}
function inside(root: string, target: string) {
  const rr = normalized(root),
    tt = normalized(target);
  const rel = path.relative(rr, tt);
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel));
}
function capabilityFor(mode: 'read' | 'write' | 'command'): Capability[] {
  return mode === 'read'
    ? ['files.read', 'files.search']
    : mode === 'write'
      ? ['files.write', 'files.delete']
      : ['commands.run'];
}
async function canonicalExistingOrParent(candidate: string, mode: 'read' | 'write' | 'command') {
  try {
    return await realpath(candidate);
  } catch (e) {
    if (mode === 'read' || mode === 'command') throw e;
    const parent = await realpath(path.dirname(candidate));
    return path.join(parent, path.basename(candidate));
  }
}
async function isHostPathOutsideRoot(logical: string, canonicalRoot: string): Promise<boolean> {
  try {
    const target = await realpath(logical);
    return !inside(canonicalRoot, target);
  } catch {
    return false;
  }
}
function normalizePrefix(value: string): string {
  const norm = ('/' + String(value ?? '').replaceAll('\\', '/'))
    .replace(/\/+/g, '/')
    .replace(/\/$/, '');
  return norm || '/';
}

function prefixMatches(logical: string, prefix: string): boolean {
  const fold = (s: string) => (process.platform === 'win32' ? s.toLowerCase() : s);
  const l = fold(logical);
  const p = fold(prefix);
  if (l === p) return true;
  return l.startsWith(p.endsWith('/') ? p : `${p}/`);
}

export async function resolveCapabilityPath(
  logicalPath: string,
  roots: CapabilityRoot[],
  mode: 'read' | 'write' | 'command',
): Promise<ResolvedCapabilityPath> {
  // Validate spelling before realpath; do not normalize away traversal.
  if (process.platform === 'win32') normalizeLogicalPath(logicalPath);
  const logical = ('/' + logicalPath.replaceAll('\\', '/')).replace(/\/+/g, '/');
  const isWindowsDrivePath = /^\/[A-Za-z]:(?:\/|$)/.test(logical);
  const candidates: Array<{ root: CapabilityRoot; prefix: string }> = [];
  for (const r of roots) {
    const lp = normalizePrefix(r.logicalPrefix);
    candidates.push({ root: r, prefix: lp });
    const hp = r.hostRoot ? normalizePrefix(r.hostRoot) : '';
    if (hp && hp !== lp) {
      candidates.push({ root: r, prefix: hp });
    }
  }
  candidates.sort((a, b) => b.prefix.length - a.prefix.length);
  const match = candidates.find(
    (c) => !(isWindowsDrivePath && c.prefix === '/') && prefixMatches(logical, c.prefix),
  );
  if (!match) throw new WorkspaceEscapeError(logicalPath);
  const { root, prefix } = match;
  if (!capabilityFor(mode).some((c) => root.capabilities.includes(c)))
    throw new Error(`Capability root ${root.id} does not allow ${mode}`);
  const relative = logical.slice(prefix.length).replace(/^\//, '');
  if (relative.split('/').some((x) => x === '..')) throw new WorkspaceEscapeError(logicalPath);
  const canonicalRoot = await realpath(root.hostRoot);
  const candidate = path.resolve(canonicalRoot, ...relative.split('/').filter(Boolean));
  let canonical: string;
  try {
    canonical = await canonicalExistingOrParent(candidate, mode);
  } catch (err) {
    if (
      prefix === '/' &&
      (err as NodeJS.ErrnoException)?.code === 'ENOENT' &&
      (await isHostPathOutsideRoot(logical, canonicalRoot))
    ) {
      throw new WorkspaceEscapeError(logicalPath);
    }
    throw err;
  }
  if (!inside(canonicalRoot, canonical)) throw new WorkspaceEscapeError(logicalPath);
  return {
    rootId: root.id,
    logicalPath: logical,
    hostPath: candidate,
    canonicalHostPath: canonical,
  };
}
