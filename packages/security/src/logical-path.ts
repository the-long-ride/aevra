/**
 * One canonical spelling for a logical workspace path, so a pattern list can
 * be matched against it.
 *
 * This exists because `classifySensitivity` tests `userPatterns` against the
 * path a tool call supplied verbatim. A model picks the spelling, and every
 * one of `aevra.json`, `/aevra.json`, `./aevra.json`, `.\aevra.json`,
 * `sub/../aevra.json` and `aevra.json/` names the same file on disk while
 * matching a different set of anchored globs. Without normalisation, a
 * declared `protectedPaths` entry - or `aevra.json`'s own self-protection -
 * was evaded by respelling the argument, and the executor's second check
 * classifies on built-in rules only, so nothing downstream caught it.
 *
 * The result is always absolute, forward-slashed, and free of `.`/`..`
 * segments, with no trailing slash (except for the root itself). It is a
 * LEXICAL normalisation: no filesystem access, no symlink resolution - those
 * belong to `resolveCapabilityPath`, which is what actually decides whether a
 * path is inside a capability root. This only fixes the spelling so a glob
 * comparison means what it looks like it means.
 *
 * A leading `..` that would escape the root is dropped rather than preserved:
 * the path is anchored at `/`, so `../../x` normalises to `/x`. Containment
 * is not this function's job, and keeping the segments would let a pattern
 * miss by the same trick this function exists to close.
 */
export function normalizeLogicalPath(value: string): string {
  const raw = String(value ?? '').replaceAll('\\', '/');
  const segments: string[] = [];
  for (const segment of raw.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return `/${segments.join('/')}`;
}
