import { existsSync, lstatSync, readdirSync, readFileSync, rmSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { hash, readText, writeAtomic } from './files.js';
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

export function claimExtension(home: string, product: Product, parent: string): void {
  const current = record(home),
    file = recordPath(home),
    before = readText(file);
  const resolved = path.resolve(parent);
  if (current && current.parent !== resolved)
    throw new Error('SHARED_EXTENSION_CONFLICT: another shared installation owns a different path');
  const next: ExtensionRecord = {
    version: 1,
    parent: resolved,
    owners: [...new Set([...(current?.owners ?? []), product])],
    files: hashes(resolved),
  };
  writeAtomic(file, JSON.stringify(next, null, 2) + '\n', before);
}

export function releaseExtension(home: string, product: Product, purge: boolean) {
  const current = record(home),
    file = recordPath(home),
    before = readText(file);
  if (!current || !current.owners.includes(product))
    return { removed: false, message: 'No managed extension ownership' };
  const owners = current.owners.filter((owner) => owner !== product);
  if (owners.length) {
    writeAtomic(file, JSON.stringify({ ...current, owners }, null, 2) + '\n', before);
    return { removed: false, message: 'Shared extension retained for the other product' };
  }
  if (purge) {
    const folder = path.resolve(current.parent, 'aevra-extension');
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
