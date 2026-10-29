import { copyFile, mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { CapabilityRoot } from '../../protocol/src/index.js';
import { resolveCapabilityPath } from '../../security/src/path-policy.js';
export async function snapshotFile(
  logicalPath: string,
  destination: string,
  roots: CapabilityRoot[],
) {
  const src = await resolveCapabilityPath(logicalPath, roots, 'read');
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(src.canonicalHostPath, destination);
  return { snapshot: destination, sizeBytes: (await stat(destination)).size };
}
export async function restoreFile(snapshot: string, logicalPath: string, roots: CapabilityRoot[]) {
  const dst = await resolveCapabilityPath(logicalPath, roots, 'write');
  await mkdir(path.dirname(dst.canonicalHostPath), { recursive: true });
  await copyFile(snapshot, dst.canonicalHostPath);
  return { path: dst.logicalPath, restored: true };
}
/** Drops one snapshot file; a missing file is fine. Only recovery snapshots are ever named. */
export async function discardSnapshot(snapshot: string) {
  if (!path.isAbsolute(snapshot) || !snapshot.endsWith('.before')) {
    throw Object.assign(new Error('Not a recovery snapshot'), { code: 'INVALID_REQUEST' });
  }
  await rm(snapshot, { force: true });
  return { discarded: true };
}
