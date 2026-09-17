import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { ProtectedGlob } from '../../../../packages/protocol/src/worker.js';
import { compileGlob } from '../../../../packages/security/src/glob.js';

const FILE_CAP_BYTES = 256 * 1024;
const MANIFEST_FILE = 'aevra.json';
// aevra.json protects itself: without this, an agent could disarm every
// declared protection with two ordinary calls (overwrite aevra.json with
// `{}`, then read whatever protectedPaths used to cover). Applying
// unconditionally, even when no file exists yet, also gates the very first
// write that creates one.
const SELF_PROTECTION_PATTERN = compileGlob(MANIFEST_FILE)!;

export interface ManifestPattern {
  pattern: RegExp;
  class: 'SENSITIVE' | 'SECRET';
  /**
   * The glob this pattern was compiled from, kept alongside the RegExp so the
   * same rule can cross the worker IPC boundary. A compiled RegExp does not
   * survive JSON, and the executor re-checks sensitivity on every read; it has
   * to be handed the source text and compile its own copy, or manifest-declared
   * paths exist only at the core authorization layer (see `globsFor`).
   */
  glob: string;
}
export interface ManifestResult {
  commands: Record<string, string>;
  protectedPatterns: ManifestPattern[];
  warning: string | null;
}
export interface ManifestSummary {
  commands: Record<string, string>;
  protectedPathsSummary: { sensitive: number; secret: number };
  warning: string | null;
}
interface ManifestWorkspaceReader {
  getLocal(workspaceId: string): { hostRoot?: string } | null | undefined;
}

interface CacheEntry {
  mtimeMs: number;
  size: number;
  result: ManifestResult;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === 'string')
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function withSelfProtection(
  result: Omit<ManifestResult, 'protectedPatterns'> & {
    protectedPatterns: ManifestPattern[];
  },
): ManifestResult {
  return {
    ...result,
    protectedPatterns: [
      ...result.protectedPatterns,
      { pattern: SELF_PROTECTION_PATTERN, class: 'SENSITIVE', glob: MANIFEST_FILE },
    ],
  };
}

/**
 * Reads a workspace's declared commands and protected-path patterns from
 * `aevra.json`, the same way `SkillsService` reads `AGENTS.md`: synchronous,
 * read live rather than cached against staleness — but unlike
 * `SkillsService.instructions()` (called roughly once per prompt fetch),
 * `authorizeResource` calls this on every single file operation, so results
 * ARE cached per workspace root, invalidated by comparing the file's
 * `mtimeMs`/`size` on each call rather than by a TTL.
 *
 * A manifest feeds security enforcement, so unlike `SkillsService`'s silent
 * swallow of a read failure, a parse failure here is never silent — it is
 * carried in `warning` rather than thrown, so a config typo degrades to "no
 * extra protection this session" instead of blocking workspace selection.
 *
 * The optional `workspaces` reader lets one instance satisfy three roles:
 * `SecurityGuard`'s `ManifestPatternSource` (via `patternsFor`, workspaceId
 * in → compiled patterns out), mcp-tools' read plumbing (via `globsFor`,
 * workspaceId in → serialisable globs out, for the executor's own
 * re-classification) and mcp-tools' `summarize` dependency (hostRoot in →
 * counts out) — callers that already have a `hostRoot` in hand can still
 * call `read`/`summarize` directly without one.
 */
export class ManifestService {
  private cache = new Map<string, CacheEntry>();

  constructor(private workspaces?: ManifestWorkspaceReader) {}

  read(workspaceRoot: string | null): ManifestResult {
    const empty: ManifestResult = { commands: {}, protectedPatterns: [], warning: null };
    if (!workspaceRoot) return empty;

    const file = path.join(workspaceRoot, MANIFEST_FILE);
    let stat;
    try {
      stat = statSync(file);
    } catch {
      this.cache.delete(workspaceRoot);
      return withSelfProtection(empty);
    }

    if (stat.size > FILE_CAP_BYTES) {
      return withSelfProtection({
        ...empty,
        warning: `aevra.json exceeds ${FILE_CAP_BYTES} bytes and was ignored`,
      });
    }

    const cached = this.cache.get(workspaceRoot);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      return cached.result;
    }

    const result = withSelfProtection(this.parse(file, empty));
    this.cache.set(workspaceRoot, { mtimeMs: stat.mtimeMs, size: stat.size, result });
    return result;
  }

  summarize(workspaceRoot: string | null): ManifestSummary {
    const result = this.read(workspaceRoot);
    return {
      commands: result.commands,
      protectedPathsSummary: {
        sensitive: result.protectedPatterns.filter((p) => p.class === 'SENSITIVE').length,
        secret: result.protectedPatterns.filter((p) => p.class === 'SECRET').length,
      },
      warning: result.warning,
    };
  }

  patternsFor(workspaceId: string): ManifestPattern[] {
    return this.read(this.workspaces?.getLocal(workspaceId)?.hostRoot ?? null).protectedPatterns;
  }

  /**
   * The same rules in the one shape that survives JSON, for the worker.
   * SECRET first, matching `SecurityGuard`'s own ordering: the executor's
   * `classifySensitivity` also returns on the first match, so a path covered
   * by both a SENSITIVE and a stricter SECRET glob has to meet SECRET first
   * or it is silently downgraded to readable on the far side of the boundary
   * too.
   */
  globsFor(workspaceId: string): ProtectedGlob[] {
    return [...this.patternsFor(workspaceId)]
      .sort((a, b) => (a.class === b.class ? 0 : a.class === 'SECRET' ? -1 : 1))
      .map((entry) => ({ glob: entry.glob, class: entry.class }));
  }

  private parse(
    file: string,
    empty: ManifestResult,
  ): Omit<ManifestResult, 'protectedPatterns'> & { protectedPatterns: ManifestPattern[] } {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      return { ...empty, protectedPatterns: [], warning: 'aevra.json could not be parsed as JSON' };
    }
    if (typeof raw !== 'object' || raw === null) {
      return { ...empty, protectedPatterns: [], warning: 'aevra.json must contain a JSON object' };
    }

    const body = raw as Record<string, unknown>;
    const commands = isStringRecord(body.commands) ? body.commands : {};

    // SECRET patterns must compile before SENSITIVE ones: classifySensitivity
    // returns on the first userPatterns match, so a path matching both a
    // declared SENSITIVE glob and a stricter SECRET glob must hit the SECRET
    // rule first, or it is silently downgraded to readable.
    const patterns: ManifestPattern[] = [];
    const badPatterns: string[] = [];
    const protectedPaths =
      typeof body.protectedPaths === 'object' && body.protectedPaths !== null
        ? (body.protectedPaths as Record<string, unknown>)
        : {};
    for (const [bucket, cls] of [
      ['secret', 'SECRET'],
      ['sensitive', 'SENSITIVE'],
    ] as const) {
      const globs = protectedPaths[bucket];
      if (!isStringArray(globs)) continue;
      for (const glob of globs) {
        const compiled = compileGlob(glob);
        if (compiled) patterns.push({ pattern: compiled, class: cls, glob });
        else badPatterns.push(glob || '(empty)');
      }
    }

    return {
      commands,
      protectedPatterns: patterns,
      warning: badPatterns.length
        ? `aevra.json: could not compile pattern(s): ${badPatterns.join(', ')}`
        : null,
    };
  }
}
