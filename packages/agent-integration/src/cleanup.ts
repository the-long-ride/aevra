import {
  existsSync,
  lstatSync,
  readdirSync,
  realpathSync,
  rmSync,
  rmdirSync,
  unlinkSync,
} from 'node:fs';
import path from 'node:path';
import { readText, writeAtomic } from './files.js';
import type { Product } from './types.js';

const MARKER = '.aevra-state-owner.json';

interface StateMarker {
  version: 1;
  product: Product;
  directory: string;
  // False when the folder already held other files the first time it was marked; those names
  // are kept by a purge. Markers written before this field existed count as owned.
  owned?: boolean;
  preexisting?: string[];
}

// Windows and macOS file systems are case-insensitive by default.
const fold = (value: string) =>
  process.platform === 'win32' || process.platform === 'darwin' ? value.toLowerCase() : value;
const same = (a: string, b: string) => fold(a) === fold(b);

// The real path of a folder that may not exist yet: links in its existing ancestors are
// resolved (macOS /var, a symlinked home), so markers compare stable paths.
function canonical(directory: string): string {
  let existing = path.resolve(directory);
  const rest: string[] = [];
  while (!existsSync(existing) && path.dirname(existing) !== existing) {
    rest.unshift(path.basename(existing));
    existing = path.dirname(existing);
  }
  return path.join(existsSync(existing) ? realpathSync(existing) : existing, ...rest);
}

function refuseSensitive(resolved: string, home: string): void {
  const sensitive = [path.parse(resolved).root, home, path.join(home, '.agents')]
    .concat(path.join(home, '.config'))
    .map(canonical);
  if (sensitive.some((value) => same(value, resolved)) || existsSync(path.join(resolved, '.git')))
    throw new Error('STATE_PURGE_UNSAFE: refusing a home, filesystem root or repository directory');
}

function readMarker(resolved: string): StateMarker | null {
  const raw = readText(path.join(resolved, MARKER));
  return raw === null ? null : (JSON.parse(raw) as StateMarker);
}

// Records which product owns a state folder. `isDefault` is true for the product's own default
// location, which it owns outright; any other folder is owned only if empty when first marked.
export function markStateDirectory(
  directory: string,
  product: Product,
  home: string,
  isDefault = false,
): void {
  const resolved = canonical(directory);
  refuseSensitive(resolved, home);
  const before = readMarker(resolved);
  if (before) {
    if (before.product !== product)
      throw new Error('STATE_OWNERSHIP_CONFLICT: directory belongs to another installation');
    // The same product's folder, moved or restored elsewhere: the marker follows it.
    if (!same(canonical(before.directory), resolved))
      writeAtomic(
        path.join(resolved, MARKER),
        JSON.stringify({ ...before, directory: resolved }) + '\n',
        readText(path.join(resolved, MARKER)),
      );
    return;
  }
  const entries = existsSync(resolved) ? readdirSync(resolved) : [];
  const owned = isDefault || entries.length === 0;
  const marker: StateMarker = {
    version: 1,
    product,
    directory: resolved,
    owned,
    preexisting: owned ? [] : entries,
  };
  writeAtomic(path.join(resolved, MARKER), JSON.stringify(marker) + '\n', null);
}

// Startup form: a marker problem must never stop the product from running.
export function tryMarkStateDirectory(
  directory: string,
  product: Product,
  home: string,
  isDefault = false,
): string | null {
  try {
    markStateDirectory(directory, product, home, isDefault);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

export interface StatePurgeResult {
  removed: boolean;
  retained: string[];
}

export interface StatePurgePreview {
  remove: string[];
  retained: string[];
}

// Checks ownership before anything is stopped or released; `run` then deletes what the product
// created, keeping files that predate the marker and any `keep` path (a shared extension).
export function prepareStatePurge(directory: string, product: Product, home: string) {
  const given = path.resolve(directory);
  if (existsSync(given) && lstatSync(given).isSymbolicLink())
    throw new Error('STATE_PURGE_UNSAFE: the state directory itself is a link');
  const resolved = canonical(given);
  refuseSensitive(resolved, home);
  const marker = readMarker(resolved);
  if (!marker)
    throw new Error(
      'STATE_OWNERSHIP_REQUIRED: start this version once before managed purge, or remove app state manually',
    );
  if (
    marker.version !== 1 ||
    marker.product !== product ||
    !same(canonical(marker.directory), resolved)
  )
    throw new Error('STATE_OWNERSHIP_CONFLICT');
  function checkTree(folder: string): void {
    for (const item of readdirSync(folder, { withFileTypes: true })) {
      if (item.isSymbolicLink()) throw new Error('STATE_PURGE_UNSAFE: symbolic entry retained');
      if (item.isDirectory()) checkTree(path.join(folder, item.name));
    }
  }
  checkTree(resolved);
  const preexisting = new Set(marker.owned === false ? (marker.preexisting ?? []) : []);
  const norm = (value: string) => fold(value);
  const inside = (child: string, parent: string) => norm(child).startsWith(norm(parent) + path.sep);
  return {
    directory: resolved,
    // What `run(keep)` would do, top level only, for `uninstall --dry-run --purge`.
    preview(keep: string[] = []): StatePurgePreview {
      const kept = keep.map(canonical);
      const result: StatePurgePreview = { remove: [], retained: [] };
      for (const name of readdirSync(resolved)) {
        if (name === MARKER) continue;
        const file = path.join(resolved, name);
        const stays = preexisting.has(name) || kept.some((k) => same(k, file));
        (stays ? result.retained : result.remove).push(file);
        if (!stays && kept.some((k) => inside(k, file)))
          result.retained.push(...kept.filter((k) => inside(k, file)));
      }
      return result;
    },
    run(keep: string[] = []): StatePurgeResult {
      const kept = keep.map(canonical);
      const retained: string[] = [];
      // A file still open (Windows: a database the core is closing) is retried briefly.
      const remove = (file: string) =>
        rmSync(file, { recursive: true, maxRetries: 10, retryDelay: 200 });
      const sweep = (folder: string, top: boolean) => {
        for (const name of readdirSync(folder)) {
          const file = path.join(folder, name);
          if (top && (name === MARKER || preexisting.has(name))) {
            if (name !== MARKER) retained.push(file);
          } else if (kept.some((k) => same(k, file))) retained.push(file);
          else if (kept.some((k) => inside(k, file))) {
            // checkTree ran at prepare time: refuse a folder swapped for a link since then.
            if (lstatSync(file).isSymbolicLink())
              throw new Error('STATE_PURGE_UNSAFE: symbolic entry retained');
            sweep(file, false);
            if (!readdirSync(file).length) rmdirSync(file);
          } else remove(file);
        }
      };
      if (existsSync(resolved)) sweep(resolved, true);
      unlinkSync(path.join(resolved, MARKER));
      const empty = !readdirSync(resolved).length;
      if (empty) rmdirSync(resolved);
      return { removed: empty, retained };
    },
  };
}

export function purgeStateDirectory(
  directory: string,
  product: Product,
  home: string,
  keep: string[] = [],
): StatePurgeResult {
  return prepareStatePurge(directory, product, home).run(keep);
}
