import { randomUUID } from 'node:crypto';
import type { CommandNode, Dialect, ExecutableIdentity } from '../types.js';

const READ_ONLY_SUBCOMMANDS = new Set([
  'status',
  'diff',
  'log',
  'show',
  'rev-parse',
  'remote',
  'describe',
]);

const REPO_STATE_SUBCOMMANDS = new Set(['checkout', 'switch', 'merge', 'rebase', 'fetch', 'pull']);

export function parseGitCommand(
  argv: string[],
  dialect: Dialect = 'direct',
  executable?: ExecutableIdentity,
): CommandNode {
  const id = `node_${randomUUID().slice(0, 8)}`;
  const options: CommandNode['options'] = [];
  const modifiers: string[] = [];
  const targets: CommandNode['targets'] = [];
  const cwdCandidates: string[] = [];
  let subcommand = '';
  const subArgs: string[] = [];
  let pastSubcommand = false;
  let forwardedArgv: string[] = [];

  let i = 1; // skip 'git'
  while (i < argv.length) {
    const token = argv[i]!;
    if (token === '--') {
      forwardedArgv = argv.slice(i + 1);
      break;
    }

    if (!pastSubcommand) {
      if (token === '-C' && i + 1 < argv.length) {
        const targetPath = argv[i + 1]!;
        options.push({ name: '-C', value: targetPath, sourceIndex: i });
        targets.push({ path: targetPath, access: 'cwd', scope: 'unknown' });
        cwdCandidates.push(targetPath);
        i += 2;
        continue;
      }
      if (token.startsWith('--git-dir=')) {
        const val = token.slice('--git-dir='.length);
        options.push({ name: '--git-dir', value: val, sourceIndex: i });
        targets.push({ path: val, access: 'read', scope: 'unknown' });
        i++;
        continue;
      }
      if (token === '--git-dir' && i + 1 < argv.length) {
        const val = argv[i + 1]!;
        options.push({ name: '--git-dir', value: val, sourceIndex: i });
        targets.push({ path: val, access: 'read', scope: 'unknown' });
        i += 2;
        continue;
      }
      if (token.startsWith('--work-tree=')) {
        const val = token.slice('--work-tree='.length);
        options.push({ name: '--work-tree', value: val, sourceIndex: i });
        targets.push({ path: val, access: 'write', scope: 'unknown' });
        i++;
        continue;
      }
      if (token === '--work-tree' && i + 1 < argv.length) {
        const val = argv[i + 1]!;
        options.push({ name: '--work-tree', value: val, sourceIndex: i });
        targets.push({ path: val, access: 'write', scope: 'unknown' });
        i += 2;
        continue;
      }
      if (!token.startsWith('-')) {
        subcommand = token.toLowerCase();
        pastSubcommand = true;
        i++;
        continue;
      }
      options.push({ name: token, sourceIndex: i });
      i++;
      continue;
    }

    // Past subcommand
    if (token.startsWith('-')) {
      if (token === '--force' || token === '-f') modifiers.push('force');
      else if (token.startsWith('--force-with-lease')) modifiers.push('force-with-lease');
      else if (token === '--hard') modifiers.push('hard');
      else if (token === '-D' || token === '-d') modifiers.push('delete', 'delete-branch');
      options.push({ name: token, sourceIndex: i });
    } else {
      subArgs.push(token);
    }
    i++;
  }

  let effect = 'UNKNOWN';
  let risk = 'LOW';

  if (!subcommand) {
    effect = 'READ_ONLY';
    risk = 'LOW';
  } else if (subcommand === 'branch') {
    if (modifiers.includes('delete-branch') || subArgs.includes('-D') || subArgs.includes('-d')) {
      effect = 'REPOSITORY_STATE';
      risk = modifiers.includes('delete-branch') ? 'HIGH' : 'MEDIUM';
    } else {
      effect = 'READ_ONLY';
      risk = 'LOW';
    }
  } else if (READ_ONLY_SUBCOMMANDS.has(subcommand)) {
    effect = 'READ_ONLY';
    risk = 'LOW';
  } else if (REPO_STATE_SUBCOMMANDS.has(subcommand)) {
    effect = 'REPOSITORY_STATE';
    risk = 'MEDIUM';
  } else if (subcommand === 'push') {
    effect = 'REPOSITORY_STATE';
    if (modifiers.includes('force') || modifiers.includes('force-with-lease')) {
      risk = 'HIGH';
    } else {
      risk = 'MEDIUM';
    }
  } else if (subcommand === 'reset') {
    effect = 'REPOSITORY_STATE';
    risk = modifiers.includes('hard') ? 'HIGH' : 'MEDIUM';
  } else if (subcommand === 'clean') {
    effect = 'SOURCE_MUTATION';
    risk = 'HIGH';
  } else if (subcommand === 'commit' || subcommand === 'add' || subcommand === 'tag') {
    effect = 'SOURCE_MUTATION';
    risk = 'MEDIUM';
  }

  const opList = subcommand ? [subcommand, ...subArgs] : ['help'];

  return {
    id,
    dialect,
    argv,
    executable,
    wrappers: [],
    application: 'git',
    operation: opList,
    options,
    forwardedArgv,
    cwdCandidates,
    modifiers,
    targets,
    effect,
    risk,
    scope: 'unknown',
    reasons: [],
  };
}
