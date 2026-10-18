import { existsSync, lstatSync, readdirSync, readFileSync, rmSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { hash, readText, writeAtomic } from './files.js';
import { withIntegrationLock } from './lock.js';
import type { Product } from './types.js';

interface ExtensionRecord {
  version: number;
  parent: string;
  owners: Product[];
  files: Record<string, string>;
}
const recordPath = (home: string) => path.join(home, '.agents/aevra/browser-extension.json');

function record(home: string): ExtensionRecord | null {
  const raw = readText(recordPath(home));
  if (!raw) return null;
  const value = JSON.parse(raw) as ExtensionRecord;
  if (
    value.version !== 1 ||
    !path.isAbsolute(value.parent) ||
    !Array.isArray(value.owners) ||
    !value.files ||
    value.owners.some((owner) => !['aevra', 'aevra-browser'].includes(owner))
  )
    throw new Error('SHARED_EXTENSION_MANIFEST_INVALID');
  return value;
}

function hashes(parent: string): Record<string, string> {
  const root = path.resolve(parent, 'aevra-extension');
  const result: Record<string, string> = {};
  function visit(folder: string) {
    if (lstatSync(folder).isSymbolicLink())
      throw new Error('SHARED_EXTENSION_CONFLICT: linked files cannot be purged');
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name);
      if (entry.isSymbolicLink()) throw new Error('SHARED_EXTENSION_CONFLICT: symbolic file');
      if (entry.isDirectory()) visit(file);
      else result[path.relative(root, file)] = hash(readFileSync(file).toString('base64'));
    }
  }
  visit(root);
  return result;
}

export function sharedExtensionDirectory(home: string, legacyParents: string[]): string {
  const current = record(home);
  if (current) return current.parent;
  const installed = [
    ...new Set(
      legacyParents.filter((parent) =>
        existsSync(path.join(parent, 'aevra-extension/manifest.json')),
      ),
    ),
  ];
  if (installed.length > 1)
    throw new Error('SHARED_EXTENSION_CONFLICT: choose the currently loaded path with --dir');
  return installed[0] ?? path.join(home, '.agents/aevra/browser');
}

const fold = (value: string) =>
  process.platform === 'win32' || process.platform === 'darwin' ? value.toLowerCase() : value;
const samePath = (a: string, b: string) => fold(path.resolve(a)) === fold(path.resolve(b));

export interface ClaimOptions {
  // False when the files on disk were kept, not written: the recorded hashes then stay, so the
  // "extension has user changes" check on release still sees edits made since they were written.
  rebaseline?: boolean;
}

export function claimExtension(
  home: string,
  product: Product,
  parent: string,
  options: ClaimOptions = {},
): void {
  withIntegrationLock(home, () => claimExtensionLocked(home, product, parent, options));
}

/** For a caller already holding the integration lock (it copies the files under that lock). */
export function claimExtensionLocked(
  home: string,
  product: Product,
  parent: string,
  options: ClaimOptions = {},
): void {
  const current = record(home),
    file = recordPath(home),
    before = readText(file);
  const resolved = path.resolve(parent);
  if (current && !samePath(current.parent, resolved))
    throw new Error(
      `SHARED_EXTENSION_CONFLICT: the shared extension is recorded at ${current.parent}`,
    );
  const next: ExtensionRecord = {
    version: 1,
    parent: current?.parent ?? resolved,
    owners: [...new Set([...(current?.owners ?? []), product])],
    files: current && options.rebaseline === false ? current.files : hashes(resolved),
  };
  writeAtomic(file, JSON.stringify(next, null, 2) + '\n', before);
}

/** Checked before anything is downloaded or written: the reason a claim of `parent` would fail. */
export function extensionClaimConflict(home: string, parent: string): string | null {
  const current = record(home);
  return current && !samePath(current.parent, parent)
    ? `SHARED_EXTENSION_CONFLICT: the shared extension is recorded at ${current.parent}; install there (--dir ${current.parent}) or uninstall it first`
    : null;
}

/** True when the recorded copy at `parent` no longer matches what was written there. */
export function extensionModified(home: string, parent: string): boolean {
  const current = record(home);
  if (!current || !samePath(current.parent, parent)) return false;
  try {
    return JSON.stringify(hashes(current.parent)) !== JSON.stringify(current.files);
  } catch {
    return true;
  }
}

/** The recorded extension folder, if any. */
function extensionFolder(home: string): string | null {
  const current = record(home);
  return current && path.resolve(current.parent, 'aevra-extension');
}

export interface ExtensionRelease {
  removed: boolean;
  message: string;
  // The extension folder left in place because another product still owns it.
  retained?: string;
}

/** What `releaseExtension` would report, changing nothing (for dry runs). */
export function previewRelease(home: string, product: Product, purge: boolean): ExtensionRelease {
  const current = record(home);
  const folder = current && path.resolve(current.parent, 'aevra-extension');
  if (!current || !current.owners.includes(product))
    return {
      removed: false,
      message: 'No managed extension ownership',
      ...(folder && current.owners.length ? { retained: folder } : {}),
    };
  if (current.owners.some((owner) => owner !== product))
    return {
      removed: false,
      message: 'Would keep the shared extension for the other product',
      retained: folder!,
    };
  return {
    removed: false,
    message: purge
      ? 'Would remove the owned extension files'
      : 'Would release the extension and keep its files',
    ...(purge ? {} : { retained: folder! }),
  };
}

// Serialised with every other ~/.agents/aevra change, so two products cannot interleave.
export function releaseExtension(home: string, product: Product, purge: boolean): ExtensionRelease {
  return withIntegrationLock(home, () => releaseUnlocked(home, product, purge));
}

/**
 * `releaseExtension` for uninstall: a release that fails (an extension the user edited, say)
 * keeps the folder and reports why, so the rest of the uninstall can finish around it.
 */
export function releaseExtensionOrKeep(
  home: string,
  product: Product,
  purge: boolean,
): ExtensionRelease {
  try {
    return releaseExtension(home, product, purge);
  } catch (error) {
    const folder = extensionFolder(home);
    return {
      removed: false,
      message: (error as Error).message,
      ...(folder ? { retained: folder } : {}),
    };
  }
}

function releaseUnlocked(home: string, product: Product, purge: boolean): ExtensionRelease {
  const current = record(home),
    file = recordPath(home),
    before = readText(file);
  const folder = current && path.resolve(current.parent, 'aevra-extension');
  if (!current || !current.owners.includes(product))
    return {
      removed: false,
      message: 'No managed extension ownership',
      ...(folder && current.owners.length ? { retained: folder } : {}),
    };
  const owners = current.owners.filter((owner) => owner !== product);
  if (owners.length) {
    writeAtomic(file, JSON.stringify({ ...current, owners }, null, 2) + '\n', before);
    return {
      removed: false,
      message: 'Shared extension retained for the other product',
      retained: folder!,
    };
  }
  if (purge && folder) {
    if (folder === path.parse(folder).root || path.dirname(folder) !== path.resolve(current.parent))
      throw new Error('SHARED_EXTENSION_PATH_INVALID');
    if (existsSync(folder)) {
      if (JSON.stringify(hashes(current.parent)) !== JSON.stringify(current.files))
        throw new Error('SHARED_EXTENSION_CONFLICT: extension has user changes; retained');
      rmSync(folder, { recursive: true });
    }
    unlinkSync(file);
    return {
      removed: true,
      message:
        'Owned files removed. Remove the load-unpacked extension in chrome://extensions or edge://extensions.',
    };
  }
  writeAtomic(file, JSON.stringify({ ...current, owners: [] }, null, 2) + '\n', before);
  return {
    removed: false,
    message:
      'Extension files retained. Remove its load-unpacked registration through browser settings.',
  };
}
