import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { CapabilityRoot } from '../../protocol/src/index.js';
import { resolveCapabilityPath } from '../../security/src/path-policy.js';
import { assertMutationAllowed } from './file-sensitivity.js';

function coded(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}

/**
 * Creates missing parent directories for a file about to be written.
 *
 * The path policy resolves a path whose parent is missing without complaint
 * but later calls fail on it, so the chain is built from the deepest directory
 * that really exists, which must itself resolve inside a writable root. The
 * secret-path check runs before anything is created.
 */
export async function ensureParent(logicalPath: string, roots: CapabilityRoot[]) {
  const parts = logicalPath.replaceAll('\\', '/').split('/').filter(Boolean);
  if (parts.some((part) => part === '.' || part === '..')) {
    throw coded('WORKSPACE_ESCAPE', `Path escapes registered capability roots: ${logicalPath}`);
  }
  const name = parts.pop();
  if (!name) throw coded('INVALID_REQUEST', 'A file path is required');
  const missing: string[] = [];
  for (;;) {
    try {
      const ancestor = await resolveCapabilityPath('/' + parts.join('/'), roots, 'write');
      await stat(ancestor.canonicalHostPath);
      if (!missing.length) return;
      const dir = path.join(ancestor.canonicalHostPath, ...missing);
      const logical = '/' + [...parts, ...missing, name].join('/');
      await assertMutationAllowed(logical, path.join(dir, name), roots);
      await mkdir(dir, { recursive: true });
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || !parts.length) throw error;
      missing.unshift(parts.pop()!);
    }
  }
}
