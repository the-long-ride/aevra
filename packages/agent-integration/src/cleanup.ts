import { existsSync, lstatSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import path from 'node:path';
import { readText, writeAtomic } from './files.js';
import type { Product } from './types.js';

function checkedDirectory(directory: string, home: string): string {
  const resolved = path.resolve(directory);
  const sensitive = [
    path.parse(resolved).root,
    path.resolve(home),
    path.join(home, '.agents'),
    path.join(home, '.config'),
  ];
  if (
    sensitive.some((value) => path.resolve(value).toLowerCase() === resolved.toLowerCase()) ||
    existsSync(path.join(resolved, '.git')) ||
    (existsSync(resolved) && lstatSync(resolved).isSymbolicLink())
  )
    throw new Error(
      'STATE_PURGE_UNSAFE: refusing a home, filesystem root, repository or linked directory',
    );
  if (existsSync(resolved) && realpathSync(resolved).toLowerCase() !== resolved.toLowerCase())
    throw new Error('STATE_PURGE_UNSAFE: linked parent directory');
  return resolved;
}

export function markStateDirectory(directory: string, product: Product, home: string): void {
  const resolved = checkedDirectory(directory, home),
    marker = path.join(resolved, '.aevra-state-owner.json');
  const before = readText(marker);
  if (
    before &&
    (JSON.parse(before).product !== product || JSON.parse(before).directory !== resolved)
  )
    throw new Error('STATE_OWNERSHIP_CONFLICT: directory belongs to another installation');
  if (!before)
    writeAtomic(marker, JSON.stringify({ version: 1, product, directory: resolved }) + '\n', null);
}

export function purgeStateDirectory(directory: string, product: Product, home: string): void {
  const resolved = checkedDirectory(directory, home);
  const raw = readText(path.join(resolved, '.aevra-state-owner.json'));
  if (!raw)
    throw new Error(
      'STATE_OWNERSHIP_REQUIRED: start this version once before managed purge, or remove app state manually',
    );
  const marker = JSON.parse(raw);
  if (marker.version !== 1 || marker.product !== product || marker.directory !== resolved)
    throw new Error('STATE_OWNERSHIP_CONFLICT');
  function checkTree(folder: string): void {
    for (const item of readdirSync(folder, { withFileTypes: true })) {
      if (item.isSymbolicLink()) throw new Error('STATE_PURGE_UNSAFE: symbolic entry retained');
      if (item.isDirectory()) checkTree(path.join(folder, item.name));
    }
  }
  checkTree(resolved);
  // The exact absolute target and its ownership have been checked before recursive removal.
  rmSync(resolved, { recursive: true });
}
