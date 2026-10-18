import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, readFile, mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import type { CapabilityRoot, ResolvedCapabilityPath } from '../../protocol/src/index.js';
import { resolveCapabilityPath } from '../../security/src/path-policy.js';
import { assertMutationAllowed } from './file-sensitivity.js';

let tempSequence = 0;
function sha256(buffer: Buffer) {
  return `sha256:${createHash('sha256').update(buffer).digest('hex')}` as const;
}

export async function revalidateMutationPath(
  previous: ResolvedCapabilityPath,
  roots: CapabilityRoot[],
) {
  const current = await resolveCapabilityPath(previous.logicalPath, roots, 'write');
  if (
    current.rootId !== previous.rootId ||
    current.canonicalHostPath !== previous.canonicalHostPath
  ) {
    throw Object.assign(new Error('Mutation path changed during validation'), {
      code: 'WORKSPACE_ESCAPE',
    });
  }
  await assertMutationAllowed(current.logicalPath, current.canonicalHostPath, roots);
  return current;
}

async function exclusiveWrite(file: string, content: string, encoding: 'utf8' | 'base64') {
  const handle = await open(
    file,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
    0o600,
  );
  try {
    await handle.writeFile(encoding === 'base64' ? Buffer.from(content, 'base64') : content);
  } finally {
    await handle.close();
  }
}

export async function fileCreate(
  logicalPath: string,
  content: string,
  roots: CapabilityRoot[],
  encoding: 'utf8' | 'base64' = 'utf8',
) {
  const resolved = await resolveCapabilityPath(logicalPath, roots, 'write');
  await assertMutationAllowed(resolved.logicalPath, resolved.canonicalHostPath, roots);
  await mkdir(path.dirname(resolved.canonicalHostPath), { recursive: true });
  const current = await revalidateMutationPath(resolved, roots);
  await exclusiveWrite(current.canonicalHostPath, content, encoding);
  await revalidateMutationPath(current, roots);
  return { path: current.logicalPath, hash: sha256(await readFile(current.canonicalHostPath)) };
}

export async function fileWrite(
  logicalPath: string,
  content: string,
  roots: CapabilityRoot[],
  encoding: 'utf8' | 'base64' = 'utf8',
) {
  const resolved = await resolveCapabilityPath(logicalPath, roots, 'write');
  await assertMutationAllowed(resolved.logicalPath, resolved.canonicalHostPath, roots);
  await mkdir(path.dirname(resolved.canonicalHostPath), { recursive: true });
  const current = await revalidateMutationPath(resolved, roots);
  const temp = `${current.canonicalHostPath}.aevra-${process.pid}-${++tempSequence}.tmp`;
  let created = false;
  try {
    await exclusiveWrite(temp, content, encoding);
    created = true;
    await revalidateMutationPath(current, roots);
    await rename(temp, current.canonicalHostPath);
    created = false;
    await revalidateMutationPath(current, roots);
    return { path: current.logicalPath, hash: sha256(await readFile(current.canonicalHostPath)) };
  } finally {
    // Only remove our temp file after proving its parent still names our root.
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

export async function fileMove(from: string, to: string, roots: CapabilityRoot[]) {
  const source = await resolveCapabilityPath(from, roots, 'write');
  const target = await resolveCapabilityPath(to, roots, 'write');
  await assertMutationAllowed(source.logicalPath, source.canonicalHostPath, roots);
  await assertMutationAllowed(target.logicalPath, target.canonicalHostPath, roots);
  await mkdir(path.dirname(target.canonicalHostPath), { recursive: true });
  await revalidateMutationPath(source, roots);
  await revalidateMutationPath(target, roots);
  await rename(source.canonicalHostPath, target.canonicalHostPath);
  return { from: source.logicalPath, to: target.logicalPath };
}

export async function fileDelete(logicalPath: string, recursive: boolean, roots: CapabilityRoot[]) {
  const resolved = await resolveCapabilityPath(logicalPath, roots, 'write');
  const current = await revalidateMutationPath(resolved, roots);
  await rm(current.canonicalHostPath, { recursive, force: false });
  return { path: current.logicalPath, deleted: true };
}
