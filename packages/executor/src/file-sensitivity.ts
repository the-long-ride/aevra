import path from 'node:path';
import { readdir, stat } from 'node:fs/promises';
import type { CapabilityRoot } from '../../protocol/src/index.js';
import {
  classifySensitivity,
  maxSensitivity,
  type Sensitivity,
} from '../../security/src/sensitive.js';
import type { CompiledProtection } from './protected-globs.js';

export function denySecret(pathValue: string): never {
  throw Object.assign(
    new Error(`Protected secret resource cannot be accessed remotely: ${pathValue}`),
    {
      code: 'CAPABILITY_REQUIRED',
    },
  );
}

function inodeKey(info: { dev: number; ino: number }) {
  return `${info.dev}:${info.ino}`;
}

function logicalForRoot(root: CapabilityRoot, fullPath: string) {
  const relative = path.relative(root.hostRoot, fullPath).split(path.sep).join('/');
  const prefix = ('/' + root.logicalPrefix.replaceAll('\\', '/'))
    .replace(/\/+/g, '/')
    .replace(/\/$/, '');
  return `${prefix === '/' ? '' : prefix}/${relative}`.replace(/\/+/g, '/') || '/';
}

export async function buildHardLinkSensitivityIndex(
  roots: CapabilityRoot[],
  userPatterns?: CompiledProtection,
) {
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
        const sensitivity = classifySensitivity({
          path: logicalForRoot(root, full),
          ...(userPatterns ? { userPatterns } : {}),
        });
        index.set(key, maxSensitivity(index.get(key) ?? 'NORMAL', sensitivity));
      }
    };
    await walk(root.hostRoot);
  }
  return index;
}

export async function effectiveSensitivity(
  logicalPath: string,
  canonicalHostPath: string,
  roots: CapabilityRoot[],
  info?: { dev: number; ino: number; nlink: number } | null,
  hardLinkIndex?: Map<string, Sensitivity>,
  userPatterns?: CompiledProtection,
) {
  const extra = userPatterns ? { userPatterns } : {};
  let sensitivity = maxSensitivity(
    classifySensitivity({ path: logicalPath, ...extra }),
    classifySensitivity({ path: canonicalHostPath, ...extra }),
  );
  if (info && info.nlink > 1) {
    const index = hardLinkIndex ?? (await buildHardLinkSensitivityIndex(roots, userPatterns));
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

// Mutations are authorized against the manifest by `SecurityGuard` on the core
// side, which holds the compiled patterns already; this check stays on the
// built-in rules deliberately, as the second opinion that does not depend on
// anything the caller supplied.
export async function assertMutationAllowed(
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
      new Error(
        `Sensitive alias requires its classified path and one-time approval: ${logicalPath}`,
      ),
      { code: 'CAPABILITY_REQUIRED' },
    );
  }
}
