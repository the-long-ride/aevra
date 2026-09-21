import path from 'node:path';
import { computeEvidenceFingerprint, computeRequestFingerprint } from './fingerprint.js';
import { propagateCwdFlow } from './cwd-flow.js';
import { evaluateScope } from './scope.js';
import { detectNestedShell, parseShellScript, parseSingleArgv } from './shells/index.js';
import { evaluateScriptTrust } from './script-trust.js';
import { ANALYSIS_BOUNDS } from './types.js';
function packageCwdOperand(node: CommandNode): string | null {
  for (let index = node.options.length - 1; index >= 0; index--) {
    const option = node.options[index]!;
    if (
      (option.name === '--prefix' || option.name === '-C' || option.name === '--dir') &&
      option.value
    ) {
      return option.value;
    }
  }
  return null;
}

import type {
  AnalysisContext,
  AnalysisServices,
  CommandAnalysis,
  CommandNode,
  CommandRequest,
  Dialect,
  ParseStatus,
  Reason,
} from './types.js';

export async function analyzeCommand(
  request: CommandRequest,
  context: AnalysisContext,
  services?: AnalysisServices,
): Promise<CommandAnalysis> {
  const requestFingerprint = computeRequestFingerprint(request);
  let nodes: CommandNode[] = [];
  let edges: CommandAnalysis['edges'] = [];
  const reasons: Reason[] = [];
  let parseStatus: ParseStatus = 'complete';

  if (services?.parse) {
    const custom = await services.parse(request, context);
    if (custom) {
      nodes = custom.nodes;
      edges = custom.edges;
      reasons.push(...custom.reasons);
      parseStatus = custom.status;
    }
  } else if (request.kind === 'script') {
    const script = request.script ?? '';
    if (Buffer.byteLength(script, 'utf8') > ANALYSIS_BOUNDS.MAX_SCRIPT_BYTES) {
      parseStatus = 'unsupported';
      reasons.push({ code: 'ANALYSIS_LIMIT', message: 'Script size exceeds 64 KiB parse budget' });
    } else {
      const dialect: Dialect =
        request.shell && request.shell !== 'auto'
          ? request.shell
          : context.platform === 'win32'
            ? 'powershell'
            : 'bash';

      const parsed = parseShellScript(script, dialect);
      nodes = parsed.nodes;
      edges = parsed.edges;
      reasons.push(...parsed.reasons);
      if (nodes.length > ANALYSIS_BOUNDS.MAX_NODES) {
        nodes = nodes.slice(0, ANALYSIS_BOUNDS.MAX_NODES);
        reasons.push({
          code: 'ANALYSIS_LIMIT',
          message: 'Node count exceeds 256 node parse budget',
        });
      }
    }
  } else {
    const argv = request.argv ?? (request.executable ? [request.executable] : []);
    if (argv.length === 0) {
      parseStatus = 'invalid';
      reasons.push({ code: 'PARSE_INVALID', message: 'Empty argv request' });
    } else {
      const nested = detectNestedShell(argv);
      if (nested) {
        const outer = parseSingleArgv(argv, 'direct');
        nodes = [outer];
        if (Buffer.byteLength(nested.script, 'utf8') > ANALYSIS_BOUNDS.MAX_SCRIPT_BYTES) {
          reasons.push({ code: 'ANALYSIS_LIMIT', message: 'Nested script exceeds 64 KiB budget' });
        } else {
          const parsed = parseShellScript(nested.script, nested.dialect);
          if (parsed.nodes.length > 0) {
            edges.push({ from: outer.id, to: parsed.nodes[0]!.id, kind: 'subshell' });
          }
          nodes.push(...parsed.nodes);
          edges.push(...parsed.edges);
          reasons.push(...parsed.reasons);
          if (nodes.length > ANALYSIS_BOUNDS.MAX_NODES) {
            nodes = nodes.slice(0, ANALYSIS_BOUNDS.MAX_NODES);
            reasons.push({ code: 'ANALYSIS_LIMIT', message: 'Node count exceeds 256 budget' });
          }
        }
      } else {
        const node = parseSingleArgv(argv, 'direct');
        nodes = [node];
      }
    }
  }

  for (const node of nodes) {
    reasons.push(...node.reasons);
  }

  // Monotonic parse status determination
  if (reasons.some((r) => r.code === 'ANALYSIS_LIMIT')) {
    parseStatus = 'unsupported';
  } else if (reasons.some((r) => r.code === 'PARSE_INVALID')) {
    parseStatus = 'invalid';
  } else if (
    reasons.some(
      (r) =>
        r.code === 'UNSUPPORTED_SYNTAX' ||
        r.code === 'DYNAMIC_SCOPE' ||
        r.code === 'UNKNOWN_OPTION',
    )
  ) {
    if (parseStatus === 'complete') parseStatus = 'partial';
  }

  // Propagate cwd flow across nodes
  const initialCwd = request.cwdLogical ?? '/';
  reasons.push(...propagateCwdFlow(initialCwd, nodes, edges));

  if (reasons.some((r) => r.code === 'ANALYSIS_LIMIT')) {
    parseStatus = 'unsupported';
  } else if (reasons.some((r) => r.code === 'PARSE_INVALID')) {
    parseStatus = 'invalid';
  } else if (
    reasons.some(
      (r) =>
        r.code === 'UNSUPPORTED_SYNTAX' ||
        r.code === 'DYNAMIC_SCOPE' ||
        r.code === 'UNKNOWN_OPTION',
    ) &&
    parseStatus === 'complete'
  ) {
    parseStatus = 'partial';
  }

  // Read config to populate script fingerprints if applicable
  if (services?.readConfig) {
    for (const node of nodes) {
      if (node.scriptName) {
        try {
          const invocationCwd = node.cwdCandidates[0] ?? initialCwd;
          const packageCwd = packageCwdOperand(node);
          const resolvedPackageCwd = packageCwd
            ? await services.canonicalize(packageCwd, invocationCwd, 'cwd', context)
            : services.canonicalizeCwd
              ? await services.canonicalizeCwd(invocationCwd, context)
              : await services.canonicalize('.', invocationCwd, 'cwd', context);

          if (resolvedPackageCwd.scope !== 'inside' || !resolvedPackageCwd.canonicalPath) {
            continue;
          }

          const config = await services.readConfig(
            path.join(resolvedPackageCwd.canonicalPath, 'package.json'),
            ANALYSIS_BOUNDS.MAX_SCRIPT_BYTES,
            context,
          );
          if (config?.text) {
            const trust = evaluateScriptTrust(node.scriptName, config.text);
            if (trust.fingerprint) {
              node.scriptFingerprint = trust.fingerprint;
            }
          }
        } catch {
          // ignore read error
        }
      }
    }
  }

  // Evaluate canonical scope
  const configuredRoots =
    context.roots ??
    (context.workspaceRoot
      ? [{ logicalPrefix: '/', hostRoot: context.workspaceRoot }]
      : [{ logicalPrefix: '/', hostRoot: undefined }]);
  const scopeResult = await evaluateScope(nodes, configuredRoots, services, context);
  reasons.push(...scopeResult.reasons);

  let finalScope = scopeResult.scope;
  if (
    reasons.some((r) => r.code === 'DYNAMIC_SCOPE' || r.code === 'ANALYSIS_LIMIT') ||
    parseStatus === 'unsupported' ||
    parseStatus === 'partial'
  ) {
    if (finalScope !== 'outside') {
      finalScope = 'unknown';
    }
  }

  // Resolve executable identity across nodes
  const exeFingerprints: string[] = [];
  if (services?.resolveExecutable) {
    for (const node of nodes) {
      if (node.application) {
        try {
          const executableName = node.argv[0] ?? node.application;
          const id = await services.resolveExecutable(
            executableName,
            node.cwdCandidates[0] ?? initialCwd,
            context,
          );
          if (id) {
            node.executable = id;
            exeFingerprints.push(id.fingerprint);
          }
          for (const wrapper of node.wrappers) {
            const wrapperId = await services.resolveExecutable(
              wrapper.identity.logicalName || wrapper.app,
              node.cwdCandidates[0] ?? initialCwd,
              context,
            );
            if (wrapperId) {
              wrapper.identity = wrapperId;
              exeFingerprints.push(`wrapper:${wrapperId.fingerprint}`);
            }
          }
        } catch {
          // Missing executable or wrapper identity remains unresolved and cannot satisfy a pinned rule.
        }
      }
    }
  }

  const primaryExeFingerprint = exeFingerprints.join(':') || 'unresolved';
  const evidenceFingerprint = computeEvidenceFingerprint(
    requestFingerprint,
    primaryExeFingerprint,
    context,
    {
      scope: finalScope,
      parseStatus,
      nodeEvidence: nodes.map((node) => ({
        executableFingerprint: node.executable?.fingerprint ?? null,
        wrapperFingerprints: node.wrappers.map((wrapper) => wrapper.identity.fingerprint),
        scriptFingerprint: node.scriptFingerprint ?? null,
        risk: node.risk,
        scope: node.scope,
        targets: node.targets.map((target) => ({
          path: target.path,
          access: target.access,
          scope: target.scope,
        })),
      })),
    },
  );

  return {
    version: 1,
    requestFingerprint,
    context,
    parseStatus,
    scope: finalScope,
    nodes,
    edges,
    reasons,
    evidenceFingerprint,
  };
}
