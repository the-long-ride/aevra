import { lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { foldsCase } from './claude-project-key.js';

const conflict = (file: string) =>
  new Error(`AGENT_PATH_CONFLICT: refusing a linked path inside the workspace: ${file}`);

const fold = (value: string) => (foldsCase() ? value.toLowerCase() : value);

const resolved = (file: string): string => {
  try {
    return realpathSync(file);
  } catch {
    return path.resolve(file);
  }
};

// True when two paths name the same place (after resolving links where they exist).
export const samePlace = (left: string, right: string): boolean =>
  fold(resolved(left)) === fold(resolved(right));

// A workspace config must be a plain file reached through plain folders of the workspace: a
// symbolic link or junction on the way (for example `<root>/.codex -> ~/.codex`) would redirect
// the write outside the workspace. The root itself may be a link. Runs before anything is read
// or written, for dry runs too.
export function assertPlainWorkspacePath(file: string, root: string): void {
  const relative = path.relative(root, file);
  if (
    !relative ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  )
    throw conflict(file);
  let current = root;
  let deepest: string | undefined;
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part);
    let linked: boolean;
    try {
      linked = lstatSync(current).isSymbolicLink();
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') break;
      throw error;
    }
    if (linked) throw conflict(current);
    deepest = current;
  }
  if (deepest === undefined) return;
  const lexical = path.join(realpathSync(root), path.relative(root, deepest));
  if (fold(realpathSync(deepest)) !== fold(lexical)) throw conflict(deepest);
}
