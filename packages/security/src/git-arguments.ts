import path from 'node:path';

function invalid(value: string): never {
  throw Object.assign(new Error(`Unsupported Git argument: ${value}`), { code: 'INVALID_REQUEST' });
}

function workspacePathspec(value: string) {
  const normalized = value.replaceAll('\\', '/');
  if (
    !value ||
    normalized.startsWith(':') ||
    path.isAbsolute(value) ||
    /^[a-z]:/i.test(value) ||
    normalized.split('/').includes('..') ||
    /[\0\r\n]/.test(value)
  )
    invalid(value);
  return value;
}

const REVISION = /^[a-zA-Z0-9][a-zA-Z0-9_./~^{}@+*-]*$/;
const COMMON = new Set([
  '-p',
  '--patch',
  '--stat',
  '--shortstat',
  '--numstat',
  '--name-only',
  '--name-status',
  '--no-patch',
  '--no-color',
  '--color=never',
  '--no-renames',
]);

export function validateGitReadArgs(kind: 'diff' | 'log' | 'branch', args: string[]) {
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) invalid('args');
  let paths = false;
  let branchPatterns = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (paths) {
      workspacePathspec(arg);
      continue;
    }
    if (arg === '--') {
      if (kind === 'branch') invalid(arg);
      paths = true;
      continue;
    }
    if (kind === 'branch') {
      if (
        [
          '--list',
          '--all',
          '-a',
          '--remotes',
          '-r',
          '--show-current',
          '--no-color',
          '--color=never',
          '-v',
          '-vv',
        ].includes(arg)
      ) {
        if (arg === '--list') branchPatterns = true;
        continue;
      }
      if (branchPatterns && REVISION.test(arg)) continue;
      invalid(arg);
    }
    if (COMMON.has(arg)) continue;
    if (kind === 'diff' && ['--cached', '--staged', '--check'].includes(arg)) continue;
    if (
      kind === 'log' &&
      ['--oneline', '--all', '--first-parent', '--reverse', '--no-merges', '--merges'].includes(arg)
    )
      continue;
    if (kind === 'log' && /^-\d{1,6}$/.test(arg)) continue;
    if (kind === 'log' && (arg === '-n' || arg === '--max-count')) {
      if (!/^\d{1,6}$/.test(args[++i] ?? '')) invalid(arg);
      continue;
    }
    if (
      /^(?:-U|--unified=)\d{1,4}$/.test(arg) ||
      (kind === 'log' && /^(?:-n|--max-count=)\d{1,6}$/.test(arg))
    )
      continue;
    // A colon can address a blob instead of a revision, and @ paths can select
    // another worktree. Keep the supported revision grammar deliberately small.
    if (REVISION.test(arg) && !arg.includes('@{')) continue;
    invalid(arg);
  }
  return args;
}

export function commitSelection(args: string[]) {
  const paths: string[] = [];
  let includeAll = false;
  let afterSeparator = false;
  for (const arg of args) {
    if (arg === '--') {
      afterSeparator = true;
      continue;
    }
    if (afterSeparator || !arg.startsWith('-')) {
      paths.push(workspacePathspec(arg));
      continue;
    }
    if (arg === '--all' || /^-[aq]+$/.test(arg)) {
      includeAll ||= arg === '--all' || arg.includes('a');
      continue;
    }
    if (
      [
        '--quiet',
        '--amend',
        '--no-edit',
        '--allow-empty',
        '--allow-empty-message',
        '--no-verify',
        '--signoff',
        '-s',
        '--reset-author',
      ].includes(arg)
    )
      continue;
    invalid(arg);
  }
  return { paths, includeAll };
}
