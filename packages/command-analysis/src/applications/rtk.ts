import { parseGitCommand } from './git.js';
import { parseNodePackageCommand } from './node-packages.js';
import type { CommandNode, Dialect, ExecutableIdentity } from '../types.js';

export function parseRtkCommand(
  argv: string[],
  dialect: Dialect = 'direct',
  rtkIdentity?: ExecutableIdentity,
): CommandNode {
  const sub = argv[1]?.toLowerCase();
  const wrapperInfo = {
    app: 'rtk',
    identity: rtkIdentity ?? {
      logicalName: argv[0] ?? 'rtk',
      canonicalPath: argv[0] ?? 'rtk',
      launcher: 'native' as const,
      fingerprint: 'unresolved',
      provenance: 'installed' as const,
      backendId: 'host',
    },
    mappingVersion: '1.0',
  };

  if (sub === 'git') {
    const gitArgv = ['git', ...argv.slice(2)];
    const node = parseGitCommand(gitArgv, dialect);
    node.wrappers = [wrapperInfo, ...node.wrappers];
    return node;
  }

  if (sub === 'npm') {
    const scriptOrSub = argv[2];
    let npmArgv: string[];
    if (
      scriptOrSub &&
      !['run', 'test', 'install', 'ci', 'audit', 'publish'].includes(scriptOrSub)
    ) {
      npmArgv = ['npm', 'run', ...argv.slice(2)];
    } else {
      npmArgv = ['npm', ...argv.slice(2)];
    }
    const node = parseNodePackageCommand('npm', npmArgv, dialect);
    node.wrappers = [wrapperInfo, ...node.wrappers];
    return node;
  }

  if (sub === 'pnpm') {
    const pnpmArgv = ['pnpm', ...argv.slice(2)];
    const node = parseNodePackageCommand('pnpm', pnpmArgv, dialect);
    node.wrappers = [wrapperInfo, ...node.wrappers];
    return node;
  }

  if (sub === 'tsc') {
    return {
      id: `node_rtk_tsc`,
      dialect,
      argv,
      wrappers: [wrapperInfo],
      application: 'tsc',
      operation: ['check'],
      options: [],
      forwardedArgv: argv.slice(2),
      cwdCandidates: [],
      modifiers: [],
      targets: [],
      effect: 'READ_ONLY',
      risk: 'LOW',
      scope: 'unknown',
      reasons: [],
    };
  }

  if (sub === 'lint') {
    return {
      id: `node_rtk_lint`,
      dialect,
      argv,
      wrappers: [wrapperInfo],
      application: 'eslint',
      operation: ['lint'],
      options: [],
      forwardedArgv: argv.slice(2),
      cwdCandidates: [],
      modifiers: [],
      targets: [],
      effect: 'READ_ONLY',
      risk: 'LOW',
      scope: 'unknown',
      reasons: [],
    };
  }

  if (sub === 'prettier') {
    const isCheck = argv.includes('--check');
    return {
      id: `node_rtk_prettier`,
      dialect,
      argv,
      wrappers: [wrapperInfo],
      application: 'prettier',
      operation: isCheck ? ['check'] : ['format'],
      options: [],
      forwardedArgv: argv.slice(2),
      cwdCandidates: [],
      modifiers: [],
      targets: [],
      effect: isCheck ? 'READ_ONLY' : 'SOURCE_MUTATION',
      risk: isCheck ? 'LOW' : 'MEDIUM',
      scope: 'unknown',
      reasons: [],
    };
  }

  if (sub === 'jest' || sub === 'vitest' || sub === 'pytest') {
    return {
      id: `node_rtk_${sub}`,
      dialect,
      argv,
      wrappers: [wrapperInfo],
      application: sub,
      operation: ['test'],
      options: [],
      forwardedArgv: argv.slice(2),
      cwdCandidates: [],
      modifiers: [],
      targets: [],
      effect: 'BUILD_OUTPUT',
      risk: 'LOW',
      scope: 'unknown',
      reasons: [],
    };
  }

  if (sub === 'cargo') {
    const cargoSub = argv[2]?.toLowerCase() ?? 'build';
    const isMut = cargoSub === 'fmt';
    return {
      id: `node_rtk_cargo_${cargoSub}`,
      dialect,
      argv,
      wrappers: [wrapperInfo],
      application: 'cargo',
      operation: [cargoSub, ...argv.slice(3)],
      options: [],
      forwardedArgv: [],
      cwdCandidates: [],
      modifiers: [],
      targets: [],
      effect: isMut ? 'SOURCE_MUTATION' : 'BUILD_OUTPUT',
      risk: 'LOW',
      scope: 'unknown',
      reasons: [],
    };
  }

  if (sub === 'dotnet') {
    const dotSub = argv[2]?.toLowerCase() ?? 'build';
    const isMut = dotSub === 'format';
    return {
      id: `node_rtk_dotnet_${dotSub}`,
      dialect,
      argv,
      wrappers: [wrapperInfo],
      application: 'dotnet',
      operation: [dotSub, ...argv.slice(3)],
      options: [],
      forwardedArgv: [],
      cwdCandidates: [],
      modifiers: [],
      targets: [],
      effect: isMut ? 'SOURCE_MUTATION' : 'BUILD_OUTPUT',
      risk: 'LOW',
      scope: 'unknown',
      reasons: [],
    };
  }

  if (sub === 'pip') {
    return {
      id: `node_rtk_pip`,
      dialect,
      argv,
      wrappers: [wrapperInfo],
      application: 'pip',
      operation: argv.slice(2),
      options: [],
      forwardedArgv: [],
      cwdCandidates: [],
      modifiers: [],
      targets: [],
      effect: 'BUILD_OUTPUT',
      risk: 'MEDIUM',
      scope: 'unknown',
      reasons: [],
    };
  }

  // Unknown RTK mapping
  return {
    id: `node_rtk_unknown`,
    dialect,
    argv,
    wrappers: [wrapperInfo],
    application: 'rtk',
    operation: argv.slice(1),
    options: [],
    forwardedArgv: [],
    cwdCandidates: [],
    modifiers: [],
    targets: [],
    effect: 'UNKNOWN',
    risk: 'HIGH',
    scope: 'unknown',
    reasons: [
      {
        code: 'UNKNOWN_OPTION',
        message: `Unrecognized RTK mapping: ${argv.slice(1).join(' ')}`,
      },
    ],
  };
}
