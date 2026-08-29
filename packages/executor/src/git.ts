import { classifySensitivity } from '../../security/src/sensitive.js';
import { runCommand } from './commands.js';

async function git(cwd: string, args: string[]) {
  return runCommand({ executable: 'git', args, cwdLogical: '/', env: {}, timeoutMs: 120_000 }, cwd);
}

export const gitStatus = (cwd: string) => git(cwd, ['status', '--porcelain=v1', '--branch']);
export const gitAdd = (cwd: string, args: string[] = []) => git(cwd, ['add', ...args]);
export const gitDiff = (cwd: string, args: string[] = []) => git(cwd, ['diff', ...args]);
export const gitLog = (cwd: string, args: string[] = []) =>
  git(cwd, ['log', '--oneline', '-n', '50', ...args]);
export const gitBranch = (cwd: string, args: string[] = []) => git(cwd, ['branch', ...args]);

export async function gitCommit(cwd: string, message: string, args: string[] = []) {
  const status = await git(cwd, ['status', '--porcelain=v1']);
  if (status.exitCode === 0 && status.stdout) {
    const lines = status.stdout.split(/\r?\n/);
    const includeUnstaged = args.includes('-a') || args.includes('--all');
    for (const line of lines) {
      if (!line.trim()) continue;
      const indexStatus = line[0];
      const workTreeStatus = line[1];
      const isStaged = indexStatus && indexStatus !== ' ' && indexStatus !== '?';
      const isModified = workTreeStatus && workTreeStatus !== ' ' && workTreeStatus !== '?';
      if (isStaged || (includeUnstaged && isModified)) {
        const filePath = line.slice(3).trim();
        const targetPath = filePath.includes('->') ? filePath.split('->').pop()!.trim() : filePath;
        if (classifySensitivity({ path: targetPath }) === 'SECRET') {
          throw Object.assign(
            new Error(`Cannot commit SECRET file in YOLO or normal mode: ${targetPath}`),
            { code: 'SECURITY_VIOLATION' },
          );
        }
      }
    }
  }
  return git(cwd, ['commit', '-m', message, ...args]);
}

export const gitPush = (cwd: string, remote?: string, branch?: string, args: string[] = []) =>
  git(cwd, ['push', ...(remote ? [remote] : []), ...(branch ? [branch] : []), ...args]);
