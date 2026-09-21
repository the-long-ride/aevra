import { randomUUID } from 'node:crypto';
import type { CommandNode, Dialect, ExecutableIdentity } from '../types.js';

const READ_ONLY_TOOLS = new Set([
  'cat',
  'ls',
  'dir',
  'echo',
  'grep',
  'rg',
  'find',
  'type',
  'head',
  'tail',
  'wc',
  'which',
  'where',
  'pwd',
]);

const SIMPLE_READ_PATH_TOOLS = new Set([
  'cat',
  'type',
  'head',
  'tail',
  'wc',
  'ls',
  'dir',
  'grep',
  'rg',
  'find',
]);
const SIMPLE_WRITE_PATH_TOOLS = new Set([
  'rm',
  'rmdir',
  'del',
  'erase',
  'remove-item',
  'mkdir',
  'md',
  'touch',
]);
const COPY_MOVE_TOOLS = new Set(['cp', 'copy', 'copy-item', 'mv', 'move']);

type PathOptionSpec = { access: 'read' | 'write'; names: string[] };

const PATH_OPTION_SPECS: Record<string, PathOptionSpec[]> = {
  cp: [{ access: 'write', names: ['--target-directory', '-t'] }],
  mv: [{ access: 'write', names: ['--target-directory', '-t'] }],
  rg: [
    { access: 'read', names: ['--file', '-f'] },
    { access: 'read', names: ['--ignore-file'] },
  ],
  grep: [
    { access: 'read', names: ['--file', '-f'] },
    { access: 'read', names: ['--exclude-from'] },
  ],
  touch: [{ access: 'read', names: ['--reference', '-r'] }],
  find: [{ access: 'read', names: ['--files0-from'] }],
};

function optionWithValue(
  exe: string,
  arg: string,
): { name: string; value?: string; access?: 'read' | 'write' } | null {
  const specs = PATH_OPTION_SPECS[exe] ?? [];
  const equals = arg.indexOf('=');
  const name = equals > 0 ? arg.slice(0, equals) : arg;
  const attached = equals > 0 ? arg.slice(equals + 1) : undefined;
  const spec = specs.find((entry) => entry.names.includes(name));
  if (spec) return { name, value: attached, access: spec.access };

  for (const entry of specs) {
    const short = entry.names.find((candidate) => /^-[A-Za-z]$/.test(candidate));
    if (short && arg.startsWith(short) && arg.length > short.length) {
      return { name: short, value: arg.slice(short.length), access: entry.access };
    }
  }
  return null;
}

function addFilesystemTargets(
  exe: string,
  args: string[],
  dialect: Dialect,
  targets: CommandNode['targets'],
  reasons: CommandNode['reasons'],
) {
  const operands: string[] = [];
  let afterDoubleDash = false;
  let explicitDestination = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (!afterDoubleDash && arg === '--') {
      afterDoubleDash = true;
      continue;
    }

    const isOption =
      !afterDoubleDash &&
      (arg.startsWith('-') || (dialect === 'cmd' && /^\/[A-Za-z?]+$/.test(arg)));
    if (!isOption) {
      operands.push(arg);
      continue;
    }

    const pathOption = optionWithValue(exe, arg);
    if (pathOption) {
      let value = pathOption.value;
      if (value === undefined && i + 1 < args.length) {
        value = args[++i]!;
      }
      if (!value) {
        reasons.push({
          code: 'UNKNOWN_OPTION',
          message: `Path-bearing option ${pathOption.name} is missing its value`,
        });
        continue;
      }
      targets.push({ path: value, access: pathOption.access!, scope: 'unknown' });
      if (
        COPY_MOVE_TOOLS.has(exe) &&
        (pathOption.name === '--target-directory' || pathOption.name === '-t')
      ) {
        explicitDestination = true;
      }
      continue;
    }

    // Value-bearing options can redirect I/O in tool-specific ways. If the
    // adapter does not model one, fail closed rather than silently dropping it.
    if (arg.startsWith('--') && arg.includes('=')) {
      reasons.push({
        code: 'UNKNOWN_OPTION',
        message: `Unmodeled value-bearing option may affect filesystem scope: ${arg.split('=')[0]}`,
      });
    }
  }

  if (SIMPLE_READ_PATH_TOOLS.has(exe)) {
    for (const operand of operands) {
      targets.push({ path: operand, access: 'read', scope: 'unknown' });
    }
  } else if (SIMPLE_WRITE_PATH_TOOLS.has(exe)) {
    for (const operand of operands) {
      targets.push({ path: operand, access: 'write', scope: 'unknown' });
    }
  } else if (COPY_MOVE_TOOLS.has(exe) && operands.length > 0) {
    if (explicitDestination) {
      for (const operand of operands) {
        targets.push({ path: operand, access: 'read', scope: 'unknown' });
      }
    } else {
      for (const operand of operands.slice(0, -1)) {
        targets.push({ path: operand, access: 'read', scope: 'unknown' });
      }
      targets.push({ path: operands.at(-1)!, access: 'write', scope: 'unknown' });
    }
  }
}

export function parseGenericCommand(
  argv: string[],
  dialect: Dialect = 'direct',
  executable?: ExecutableIdentity,
): CommandNode {
  const id = `node_${randomUUID().slice(0, 8)}`;
  const rawExe = argv[0] ?? '';
  const exe =
    rawExe
      .split(/[\\/]/)
      .pop()
      ?.toLowerCase()
      .replace(/\.exe$/, '') ?? 'unknown';
  const subArgs = argv.slice(1);
  const options: CommandNode['options'] = [];
  const modifiers: string[] = [];
  const targets: CommandNode['targets'] = [];
  const cwdCandidates: string[] = [];
  const reasons: CommandNode['reasons'] = [];

  if (exe === 'cd' || exe === 'chdir' || exe === 'set-location' || exe === 'pushd') {
    let targetDir = '';
    for (let i = 0; i < subArgs.length; i++) {
      const arg = subArgs[i]!;
      if (/^[/-]d$/i.test(arg) && i + 1 < subArgs.length) {
        targetDir = subArgs[i + 1]!;
        i++;
      } else if (/^-(?:Path|LiteralPath)$/i.test(arg) && i + 1 < subArgs.length) {
        targetDir = subArgs[i + 1]!;
        i++;
      } else if (!arg.startsWith('-') || arg === '--') {
        if (arg === '--' && i + 1 < subArgs.length) {
          targetDir = subArgs[i + 1]!;
        } else if (arg !== '--') {
          targetDir = arg;
        }
        break;
      }
    }
    if (targetDir) {
      targets.push({ path: targetDir, access: 'cwd', scope: 'unknown' });
      cwdCandidates.push(targetDir);
    }
    return {
      id,
      dialect,
      argv,
      executable,
      wrappers: [],
      application: 'builtin:cd',
      operation: ['cd', ...(targetDir ? [targetDir] : [])],
      options,
      forwardedArgv: [],
      cwdCandidates,
      modifiers,
      targets,
      effect: 'READ_ONLY',
      risk: 'LOW',
      scope: 'unknown',
      reasons,
    };
  }

  for (let i = 0; i < subArgs.length; i++) {
    const arg = subArgs[i]!;
    if (arg.startsWith('-') || (dialect === 'cmd' && arg.startsWith('/'))) {
      const parsedOption = optionWithValue(exe, arg);
      const separatedValue =
        parsedOption && parsedOption.value === undefined && i + 1 < subArgs.length
          ? subArgs[i + 1]
          : undefined;
      options.push({
        name: parsedOption?.name ?? (arg.includes('=') ? arg.slice(0, arg.indexOf('=')) : arg),
        value: parsedOption?.value ?? separatedValue,
        sourceIndex: i + 1,
      });
      const lower = arg.toLowerCase();
      if (lower === '-f' || lower === '--force') modifiers.push('force');
      if (lower === '-r' || lower === '-rf' || lower === '--recursive' || lower === '/s') {
        modifiers.push('recursive');
      }
    }
  }

  addFilesystemTargets(exe, subArgs, dialect, targets, reasons);

  let effect = 'UNKNOWN';
  let risk = 'MEDIUM';

  if (
    exe === 'find' &&
    subArgs.some((arg) =>
      ['-delete', '-exec', '-execdir', '-ok', '-okdir'].includes(arg.toLowerCase()),
    )
  ) {
    effect = 'SOURCE_MUTATION';
    risk = 'HIGH';
  } else if (READ_ONLY_TOOLS.has(exe)) {
    effect = 'READ_ONLY';
    risk = 'LOW';
  } else if (['rm', 'rmdir', 'del', 'erase', 'remove-item'].includes(exe)) {
    effect = 'SOURCE_MUTATION';
    risk = modifiers.includes('recursive') ? 'HIGH' : 'MEDIUM';
  } else if (['mkdir', 'md', 'touch', 'cp', 'copy', 'mv', 'move', 'copy-item'].includes(exe)) {
    effect = 'SOURCE_MUTATION';
    risk = 'MEDIUM';
  }

  return {
    id,
    dialect,
    argv,
    executable,
    wrappers: [],
    application: exe,
    operation: [exe, ...subArgs],
    options,
    forwardedArgv: [],
    cwdCandidates,
    modifiers,
    targets,
    effect,
    risk,
    scope: 'unknown',
    reasons,
  };
}
