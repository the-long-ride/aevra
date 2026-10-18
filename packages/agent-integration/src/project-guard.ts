import { spawnSync } from 'node:child_process';
import {
  accessSync,
  appendFileSync,
  constants,
  existsSync,
  mkdirSync,
  realpathSync,
  statSync,
} from 'node:fs';
import path from 'node:path';
import { foldsCase } from './claude-project-key.js';
import { executableNames } from './detect.js';
import { readText } from './files.js';

export interface GitResult {
  missing: boolean; // no usable git outside the workspace, or it could not be started
  status: number | null;
  stdout: string;
  stderr: string;
}
export type GitRunner = (root: string, args: string[]) => GitResult;
type Env = Record<string, string | undefined>;

// On Windows the native call expands 8.3 short names and drops the device prefixes, so two
// spellings of one folder resolve to the same text.
const real = (file: string, platform: NodeJS.Platform): string => {
  try {
    return platform === 'win32' ? realpathSync.native(file) : realpathSync(file);
  } catch {
    return path.resolve(file);
  }
};

function isInside(file: string, root: string, platform: NodeJS.Platform): boolean {
  const fold = (value: string) => (foldsCase(platform) ? value.toLowerCase() : value);
  const pairs = [
    [path.resolve(file), path.resolve(root)],
    [real(file, platform), real(root, platform)],
  ];
  return pairs.some(([child, parent]) => {
    const relative = path.relative(fold(parent), fold(child));
    return (
      relative === '' ||
      (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
    );
  });
}

function usable(file: string, win: boolean): boolean {
  try {
    if (!statSync(file).isFile()) return false;
    if (!win) accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

// `\\?\` and `\\.\` device paths bypass normal path parsing, so such PATH entries are skipped.
const DEVICE_PREFIX = /^[\\/]{2}[?.][\\/]/;

// The absolute git to start, found on PATH without spawning anything. A bare `git` would let
// Windows run `<cwd>\git.exe` first, so empty, relative and device-path PATH entries are skipped
// and any candidate inside the workspace folder (lexically or through a link or short name) is
// refused. Only .com and .exe start without a shell. Nothing that depends on `root` is cached.
export function findGit(
  root: string,
  env: Env = process.env,
  platform: NodeJS.Platform = process.platform,
): string | null {
  const win = platform === 'win32';
  const searchPath =
    env.PATH ??
    (win ? Object.entries(env).find(([key]) => key.toUpperCase() === 'PATH')?.[1] : undefined);
  if (!searchPath) return null;
  const names = executableNames('git', env, win).filter(
    (name) => !win || /\.(com|exe)$/i.test(name),
  );
  for (const entry of searchPath.split(win ? ';' : ':')) {
    const dir = win ? entry.trim().replace(/^"(.*)"$/, '$1') : entry;
    const absolute = win
      ? /^([A-Za-z]:[\\/]|[\\/]{2})/.test(dir) && !DEVICE_PREFIX.test(dir)
      : path.isAbsolute(dir);
    if (!dir || !absolute) continue;
    for (const name of names) {
      const file = path.join(dir, name);
      if (usable(file, win) && !isInside(file, root, platform)) return file;
    }
  }
  return null;
}

// True when `root` or a folder above it holds `.git` (a folder, or a file in a linked worktree).
function inRepository(root: string): boolean {
  for (let dir = path.resolve(root); ; dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, '.git'))) return true;
    if (path.dirname(dir) === dir) return false;
  }
}

// Runs `git` (already located, or null) with an argument array and no shell. The repository's
// own config must not run code (core.fsmonitor), and inherited GIT_* variables must not redirect
// the repository.
function spawnGit(git: string | null, root: string, args: string[]): GitResult {
  if (!git) return { missing: true, status: null, stdout: '', stderr: '' };
  const env = { ...process.env };
  for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR'])
    delete env[name];
  const result = spawnSync(git, ['-c', 'core.fsmonitor=false', ...args], {
    cwd: root,
    env,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 15000,
  });
  const missing = (result.error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
  return {
    missing,
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr || (result.error ? String(result.error.message) : ''),
  };
}

export const runGit: GitRunner = (root, args) => spawnGit(findGit(root), root, args);

// Git as one operation sees it: located on the caller's PATH (`env`) once per folder, then
// reused by every guard, exclude and note of that operation. A new context per operation, so
// nothing that depends on `root` outlives it.
export interface GitContext {
  run: GitRunner;
  // A repository whose git cannot be found outside the project: tracking cannot be checked,
  // which the spec treats like no git at all (skip), so the caller only reports it.
  unverified(root: string): boolean;
}
export function gitContext(env: Env, find: typeof findGit = findGit): GitContext {
  const found = new Map<string, string | null>();
  const locate = (root: string): string | null => {
    if (!found.has(root)) found.set(root, find(root, env));
    return found.get(root) ?? null;
  };
  return {
    run: (root, args) => spawnGit(locate(root), root, args),
    unverified: (root) => locate(root) === null && inRepository(root),
  };
}

// An ignore rule cannot protect a tracked file, so a workspace install must not edit one. Only
// exit status 1 means "untracked"; a missing git or a folder that is not a repository is skipped,
// and any other git failure refuses, because the file might be tracked. Runs for files that are
// missing on disk too (a tracked-but-deleted file must not be recreated).
export function assertNotTracked(file: string, root: string, run: GitRunner = runGit): void {
  const result = run(root, ['ls-files', '--error-unmatch', '--', file]);
  if (result.missing || result.status === 1) return;
  if (result.status === 0) throw new Error(`AGENT_PROJECT_FILE_TRACKED: ${file}`);
  if (/not a git repository/i.test(result.stderr)) return;
  const reason = result.stderr
    .split(/\r?\n/)
    .find((line) => line.trim())
    ?.trim();
  throw new Error(
    `AGENT_PROJECT_FILE_TRACKED: could not verify git tracking for ${file}: ${reason ?? `git exited with ${result.status}`}`,
  );
}

const escapePattern = (value: string) => value.replace(/[\\*?[\]]/g, '\\$&');

// Adds `file` to the repository's info/exclude (never a tracked .gitignore). `write: false` only
// reports what would happen. The pattern is anchored to the work tree top level, which can be
// above `root`; a linked worktree resolves to the shared repository file.
export function excludeFromGit(
  file: string,
  root: string,
  write = true,
  run: GitRunner = runGit,
): 'excluded' | 'already' | 'skipped' {
  const result = run(root, [
    'rev-parse',
    '--is-inside-work-tree',
    '--show-prefix',
    '--git-path',
    'info/exclude',
  ]);
  if (result.status !== 0) return 'skipped';
  const [inside, prefix, exclude] = result.stdout.split(/\r?\n/);
  const relative = path.relative(root, file).split(path.sep).join('/');
  if (inside !== 'true' || !exclude || !relative || relative.startsWith('..')) return 'skipped';
  if (path.isAbsolute(relative)) return 'skipped';
  const pattern = `/${escapePattern(prefix + relative)}`;
  const target = path.resolve(root, exclude);
  const before = readText(target) ?? '';
  if (before.split(/\r?\n/).some((line) => line.trim() === pattern)) return 'already';
  if (write) {
    mkdirSync(path.dirname(target), { recursive: true });
    appendFileSync(target, `${before && !before.endsWith('\n') ? '\n' : ''}${pattern}\n`);
  }
  return 'excluded';
}
