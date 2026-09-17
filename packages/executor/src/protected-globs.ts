import type { ProtectedGlob } from '../../protocol/src/worker.js';
import { compileGlob } from '../../security/src/glob.js';
import type { Sensitivity } from '../../security/src/sensitive.js';

export type CompiledProtection = Array<{ pattern: RegExp; class: Sensitivity }>;

/**
 * Compiles the workspace-declared protected paths carried on a read operation
 * into the `userPatterns` shape `classifySensitivity` consumes.
 *
 * Compiled once per operation rather than once per candidate file: a search
 * walk classifies every file it touches, and recompiling a pattern list for
 * each of them would put a RegExp constructor in the inner loop.
 *
 * A glob that does not compile is dropped, not treated as matching
 * everything. `ManifestService` already reports uncompilable patterns to the
 * operator through its `warning` field, so the failure is visible there; here
 * the alternative - a rule that silently matches every path - would deny an
 * entire workspace over one typo.
 */
export function compileProtectedGlobs(globs?: ProtectedGlob[]): CompiledProtection | undefined {
  if (!globs?.length) return undefined;
  const compiled: CompiledProtection = [];
  for (const entry of globs) {
    const pattern = compileGlob(entry.glob);
    if (pattern) compiled.push({ pattern, class: entry.class });
  }
  return compiled.length ? compiled : undefined;
}
