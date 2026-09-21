import { randomUUID } from 'node:crypto';
import type { CommandNode, Dialect, ExecutableIdentity } from '../types.js';

export function parseNodePackageCommand(
  app: 'npm' | 'pnpm' | 'yarn' | 'bun',
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
  let scriptName: string | undefined;
  const subArgs: string[] = [];
  let pastSubcommand = false;
  let forwardedArgv: string[] = [];

  let i = 1; // skip executable name
  while (i < argv.length) {
    const token = argv[i]!;
    if (token === '--') {
      forwardedArgv = argv.slice(i + 1);
      break;
    }

    if (token === '--prefix' && i + 1 < argv.length) {
      const val = argv[i + 1]!;
      options.push({ name: '--prefix', value: val, sourceIndex: i });
      targets.push({ path: val, access: 'cwd', scope: 'unknown' });
      i += 2;
      continue;
    }
    if (token.startsWith('--prefix=')) {
      const val = token.slice('--prefix='.length);
      options.push({ name: '--prefix', value: val, sourceIndex: i });
      targets.push({ path: val, access: 'cwd', scope: 'unknown' });
      i++;
      continue;
    }
    if ((token === '--dir' || token === '-C') && i + 1 < argv.length) {
      const val = argv[i + 1]!;
      options.push({ name: token, value: val, sourceIndex: i });
      targets.push({ path: val, access: 'cwd', scope: 'unknown' });
      i += 2;
      continue;
    }

    if (token.startsWith('-')) {
      if (token === '--force' || token === '-f') modifiers.push('force');
      if (token === '--global' || token === '-g') modifiers.push('global');
      options.push({ name: token, sourceIndex: i });
      i++;
      continue;
    }

    if (!pastSubcommand) {
      subcommand = token.toLowerCase();
      pastSubcommand = true;
      if (subcommand === 'run' && i + 1 < argv.length && !argv[i + 1]!.startsWith('-')) {
        scriptName = argv[i + 1]!;
        i += 2;
        continue;
      }
      i++;
      continue;
    }

    subArgs.push(token);
    i++;
  }

  let effect = 'UNKNOWN';
  let risk = 'LOW';

  if (!subcommand) {
    effect = 'READ_ONLY';
    risk = 'LOW';
  } else if (subcommand === 'run') {
    effect = 'SOURCE_MUTATION';
    risk = 'MEDIUM';
  } else if (subcommand === 'test' || subcommand === 'lint') {
    effect = 'BUILD_OUTPUT';
    risk = 'LOW';
  } else if (subcommand === 'audit') {
    if (subArgs.includes('--fix') || options.some((o) => o.name === '--fix')) {
      effect = 'SOURCE_MUTATION';
      risk = 'MEDIUM';
      modifiers.push('fix');
    } else {
      effect = 'READ_ONLY';
      risk = 'LOW';
    }
  } else if (['install', 'add', 'ci', 'update'].includes(subcommand)) {
    effect = 'BUILD_OUTPUT';
    risk = modifiers.includes('global') ? 'HIGH' : 'MEDIUM';
  } else if (['publish'].includes(subcommand)) {
    effect = 'SOURCE_MUTATION';
    risk = 'HIGH';
  } else if (['exec', 'dlx'].includes(subcommand)) {
    effect = 'UNKNOWN';
    risk = 'HIGH';
  }

  const opList = subcommand ? [subcommand, ...(scriptName ? [scriptName] : subArgs)] : ['help'];

  return {
    id,
    dialect,
    argv,
    executable,
    wrappers: [],
    application: app,
    operation: opList,
    scriptName,
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
