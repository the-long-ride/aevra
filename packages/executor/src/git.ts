import { gitFileExclusions, gitPathSensitivity } from './git-protection.js';
import type { ProtectedGlob } from '../../protocol/src/worker.js';
import { commitSelection, validateGitReadArgs } from '../../security/src/git-arguments.js';
import { protectedGitArgs, runGit } from './git-runtime.js';

export const gitStatus = (cwd: string) => runGit(cwd, ['status', '--porcelain=v1', '--branch']);
export const gitAdd = (cwd: string, args: string[] = []) => runGit(cwd, ['add', ...args]);
export const gitDiff = async (cwd: string, args: string[] = [], protectedGlobs?: ProtectedGlob[]) =>
  runGit(cwd, [
    'diff',
    ...protectedGitArgs(
      validateGitReadArgs('diff', args),
      protectedGlobs,
      await gitFileExclusions(cwd, protectedGlobs),
    ),
  ]);
export const gitLog = async (cwd: string, args: string[] = [], protectedGlobs?: ProtectedGlob[]) =>
  runGit(cwd, [
    'log',
    '--oneline',
    '-n',
    '50',
    ...protectedGitArgs(
      validateGitReadArgs('log', args),
      protectedGlobs,
      await gitFileExclusions(cwd, protectedGlobs),
    ),
  ]);
export const gitBranch = async (cwd: string, args: string[] = []) =>
  runGit(cwd, ['branch', ...validateGitReadArgs('branch', args)]);

export async function gitCommit(
  cwd: string,
  message: string,
  args: string[] = [],
  protectedGlobs?: ProtectedGlob[],
) {
  const { paths, includeAll } = commitSelection(args);
  const selections = [
    await runGit(cwd, ['diff', '--cached', '--name-only', '-z', '--no-renames'], true),
  ];
  if (includeAll || paths.length)
    selections.push(
      await runGit(cwd, ['diff', '--name-only', '-z', '--no-renames', '--', ...paths], true),
    );
  for (const result of selections) {
    if (result.exitCode !== 0)
      throw Object.assign(new Error('Cannot inspect Git commit selection'), {
        code: 'SECURITY_VIOLATION',
      });
    for (const targetPath of result.stdout.split('\0').filter(Boolean)) {
      if ((await gitPathSensitivity(cwd, targetPath, protectedGlobs)) === 'SECRET') {
        throw Object.assign(
          new Error(`Cannot commit SECRET file in YOLO or normal mode: ${targetPath}`),
          { code: 'SECURITY_VIOLATION' },
        );
      }
    }
  }
  return runGit(cwd, ['commit', '-m', message, ...args]);
}

export const gitPush = (cwd: string, remote?: string, branch?: string, args: string[] = []) =>
  runGit(cwd, ['push', ...(remote ? [remote] : []), ...(branch ? [branch] : []), ...args]);
