const DOUBLE_STAR_PREFIX = /^\*\*\//;
const DOUBLE_STAR_SUFFIX = /\/\*\*$/;

function compileSegment(pattern: string): string {
  let source = '';
  let index = 0;
  while (index < pattern.length) {
    if (pattern.startsWith('**', index)) {
      source += '.*';
      index += 2;
      continue;
    }
    const char = pattern[index]!;
    if (char === '*') {
      source += '[^/\\\\]*';
    } else if (char === '/') {
      source += '[/\\\\]';
    } else {
      source += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    index += 1;
  }
  return source;
}

/**
 * Compiles a small glob dialect to an anchored RegExp matching a full logical
 * path, the same shape `classifySensitivity`'s `userPatterns` already tests
 * against (`rule.pattern.test(input.path)` — the raw, un-normalized
 * `logicalPath` a tool call supplied, not the lower-cased/slash-normalized
 * form `classifySensitivity` computes for its own hardcoded checks further
 * down the same function). So the compiled regex itself tolerates:
 *
 * - an optional single leading `/` (MCP clients commonly pass `/config/x`
 *   for a pattern declared as `config/x`);
 * - either `/` or `\` as a path separator (Windows-style paths are the norm
 *   on this host);
 * - case-insensitive matching (NTFS is case-insensitive).
 *
 * Deliberately not a general-purpose glob engine: no brace expansion, no
 * character classes, no negation. Those add real parsing surface for a
 * feature whose whole point is a short, auditable path list.
 *
 * `*`     matches any run of characters except a path separator.
 * `**`    matches any run of characters including separators, including none.
 * `**\/`  as a prefix also matches at depth zero (`**\/id_rsa` matches `id_rsa`).
 * `\/**`  as a suffix also matches the directory itself, not only its
 *         contents (`vendor/keys/**` matches `vendor/keys` with no suffix at
 *         all — otherwise a recursive delete of exactly that directory would
 *         not match and would be silently allowed).
 * Everything else is escaped and matched literally.
 */
export function compileGlob(pattern: string): RegExp | null {
  if (!pattern) return null;

  let body = pattern;
  let prefixOptional = false;
  let suffixOptional = false;
  if (DOUBLE_STAR_PREFIX.test(body)) {
    prefixOptional = true;
    body = body.slice(3);
  }
  if (DOUBLE_STAR_SUFFIX.test(body)) {
    suffixOptional = true;
    body = body.slice(0, -3);
  }

  const core = body ? compileSegment(body) : '.*';
  const prefix = prefixOptional ? '(?:.*[/\\\\])?' : '';
  const suffix = suffixOptional ? '(?:[/\\\\].*)?' : '';

  try {
    return new RegExp(`^/?${prefix}${core}${suffix}$`, 'i');
  } catch {
    return null;
  }
}
