import { parseGitCommand } from '../applications/git.js';
import { parseNodePackageCommand } from '../applications/node-packages.js';
import { parseRtkCommand } from '../applications/rtk.js';
import { parseGenericCommand } from '../applications/generic.js';
import type { CommandNode, Dialect, Reason } from '../types.js';
import { ANALYSIS_BOUNDS } from '../types.js';
import { tokenizeBash } from './bash.js';
import { tokenizeCmd } from './cmd.js';
import { tokenizePowerShell, type ParsedShellStage } from './powershell.js';
import { performance } from 'node:perf_hooks';

export interface ParseShellResult {
  nodes: CommandNode[];
  edges: Array<{
    from: string;
    to: string;
    kind: 'sequence' | 'success' | 'failure' | 'pipe' | 'subshell';
  }>;
  reasons: Reason[];
}

function parseSingleArgv(argv: string[], dialect: Dialect): CommandNode {
  const exe = argv[0]?.toLowerCase() ?? '';
  const cleanExe =
    exe
      .split(/[\\/]/)
      .pop()
      ?.replace(/\.exe$/, '') ?? '';

  if (cleanExe === 'git') {
    return parseGitCommand(argv, dialect);
  }
  if (['npm', 'pnpm', 'yarn', 'bun'].includes(cleanExe)) {
    return parseNodePackageCommand(cleanExe as any, argv, dialect);
  }
  if (cleanExe === 'rtk') {
    return parseRtkCommand(argv, dialect);
  }
  return parseGenericCommand(argv, dialect);
}

function detectNestedShell(argv: string[]): { dialect: Dialect; script: string } | null {
  const exe = argv[0]?.toLowerCase() ?? '';
  const cleanExe =
    exe
      .split(/[\\/]/)
      .pop()
      ?.replace(/\.exe$/, '') ?? '';

  if (cleanExe === 'cmd') {
    const cIndex = argv.findIndex((a) => a.toLowerCase() === '/c');
    if (cIndex !== -1 && cIndex + 1 < argv.length) {
      return { dialect: 'cmd', script: argv.slice(cIndex + 1).join(' ') };
    }
  }

  if (['powershell', 'pwsh'].includes(cleanExe)) {
    const cIndex = argv.findIndex((a) => /-(?:c|command)$/i.test(a));
    if (cIndex !== -1 && cIndex + 1 < argv.length) {
      return {
        dialect: cleanExe === 'pwsh' ? 'pwsh' : 'powershell',
        script: argv.slice(cIndex + 1).join(' '),
      };
    }
  }

  if (['bash', 'sh', 'zsh'].includes(cleanExe)) {
    const cIndex = argv.findIndex((a) => a === '-c' || a === '-lc');
    if (cIndex !== -1 && cIndex + 1 < argv.length) {
      return {
        dialect: cleanExe as Dialect,
        script: argv.slice(cIndex + 1).join(' '),
      };
    }
  }

  return null;
}

export interface ParseBudget {
  startedAtMs: number;
  now?: () => number;
}

function isBudgetExceeded(budget: ParseBudget): boolean {
  const now = budget.now ?? (() => performance.now());
  return now() - budget.startedAtMs > ANALYSIS_BOUNDS.PARSE_BUDGET_MS;
}

function budgetReason(): Reason {
  return {
    code: 'ANALYSIS_LIMIT',
    message: `Parse time exceeds ${ANALYSIS_BOUNDS.PARSE_BUDGET_MS} ms budget`,
  };
}

export function parseShellScript(
  script: string,
  dialect: Dialect,
  depth = 0,
  budget?: ParseBudget,
): ParseShellResult {
  const nodes: CommandNode[] = [];
  const edges: ParseShellResult['edges'] = [];
  const reasons: Reason[] = [];
  const activeBudget: ParseBudget = budget ?? {
    startedAtMs: performance.now(),
    now: () => performance.now(),
  };

  if (isBudgetExceeded(activeBudget)) {
    return { nodes, edges, reasons: [budgetReason()] };
  }

  if (script.length > ANALYSIS_BOUNDS.MAX_SCRIPT_BYTES) {
    reasons.push({
      code: 'ANALYSIS_LIMIT',
      message: `Script exceeds maximum byte limit (${script.length} > ${ANALYSIS_BOUNDS.MAX_SCRIPT_BYTES})`,
    });
    return { nodes, edges, reasons };
  }

  if (depth > ANALYSIS_BOUNDS.MAX_NESTED_DEPTH) {
    reasons.push({
      code: 'ANALYSIS_LIMIT',
      message: `Exceeded nested shell depth limit (${depth})`,
    });
    return { nodes, edges, reasons };
  }

  let tokenResult: { stages: ParsedShellStage[]; reasons: Reason[] };
  if (dialect === 'cmd') {
    tokenResult = tokenizeCmd(script);
  } else if (dialect === 'pwsh' || dialect === 'powershell') {
    tokenResult = tokenizePowerShell(script);
  } else {
    tokenResult = tokenizeBash(script);
  }

  reasons.push(...tokenResult.reasons);
  const stages = tokenResult.stages;

  if (isBudgetExceeded(activeBudget)) {
    reasons.push(budgetReason());
    return { nodes, edges, reasons };
  }

  for (let i = 0; i < stages.length; i++) {
    if (isBudgetExceeded(activeBudget)) {
      reasons.push(budgetReason());
      break;
    }
    if (nodes.length >= ANALYSIS_BOUNDS.MAX_NODES) {
      reasons.push({
        code: 'ANALYSIS_LIMIT',
        message: `Exceeded maximum node limit (${ANALYSIS_BOUNDS.MAX_NODES})`,
      });
      break;
    }

    const stage = stages[i]!;
    const nested = detectNestedShell(stage.argv);
    const node = parseSingleArgv(stage.argv, dialect);
    for (const redir of stage.redirects) {
      node.targets.push({
        path: redir.path,
        access: redir.kind === 'read' ? 'read' : 'write',
        scope: 'unknown',
      });
    }

    if (nodes.length > 0 && stages[i - 1]?.edgeToNext) {
      edges.push({
        from: nodes.at(-1)!.id,
        to: node.id,
        kind: stages[i - 1]!.edgeToNext!,
      });
    }

    // Preserve the outer launcher node. Its executable identity and redirects
    // are execution evidence even when the nested script is expanded.
    nodes.push(node);

    if (nested) {
      const nestedResult = parseShellScript(nested.script, nested.dialect, depth + 1, activeBudget);
      reasons.push(...nestedResult.reasons);
      if (nestedResult.nodes.length > 0) {
        edges.push({
          from: node.id,
          to: nestedResult.nodes[0]!.id,
          kind: 'subshell',
        });
        nodes.push(...nestedResult.nodes);
        edges.push(...nestedResult.edges);
      }
    }
  }

  return { nodes, edges, reasons };
}

export { parseSingleArgv, detectNestedShell };
