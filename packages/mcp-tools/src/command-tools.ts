import {
  normalizeYoloMode,
  type CommandRequest,
  type ExecutionMode,
  type RiskTier,
} from '../../protocol/src/index.js';
import { classifyCommand } from '../../../apps/core/src/policy/command-family.js';
import { commandPermissionMatcher } from '../../../apps/core/src/policy/command-matcher.js';
import { evaluateAndDecideCommand } from './command-decision-bridge.js';
import { bindCommandApproval } from '../../../apps/core/src/approvals/command-binding.js';
import { resumeApproval } from './approval-resume.js';
import { authorizeCapability } from './authorization.js';
import { AevraToolError } from './errors.js';
import { buildShellCommand, resolveShellKind, shellRiskFloor } from './shell-command.js';
import { argsHash, maxRisk, oneTimeAllowed, requiredLease } from './service-helpers.js';
import type { McpRuntimeContext } from './service-types.js';

interface ShellSource {
  tool: 'shell_run';
  shell: string;
  script: string;
  riskFloor: RiskTier;
}

interface ExecutionSettings {
  sandboxBackend?: 'auto' | 'docker' | 'podman' | 'native';
}

function resolveExecutionMode(context: McpRuntimeContext, requestedMode: unknown): ExecutionMode {
  if (requestedMode === 'host' || requestedMode === 'sandbox') {
    return requestedMode;
  }
  const execution = context.deps.settings?.get<ExecutionSettings>('execution.settings', {
    sandboxBackend: 'auto',
  });
  return execution?.sandboxBackend === 'native' ? 'host' : 'sandbox';
}

export async function shellTool(context: McpRuntimeContext, sessionId: string, args: any) {
  const mode = resolveExecutionMode(context, args.executionMode);
  const recommendedShell = context.deps.systemCapabilities?.os.recommendedShell;
  const command = buildShellCommand(
    { ...args, executionMode: mode },
    process.platform,
    recommendedShell,
  );
  const shell = resolveShellKind(
    { ...args, executionMode: mode },
    process.platform,
    recommendedShell,
  );
  return commandTool(
    context,
    sessionId,
    {
      command,
      executionMode: mode,
      networkDestinations: args.networkDestinations,
    },
    {
      tool: 'shell_run',
      shell,
      script: String(args.script ?? ''),
      riskFloor: shellRiskFloor(mode),
    },
  );
}

export async function commandTool(
  context: McpRuntimeContext,
  sessionId: string,
  args: any,
  source?: ShellSource,
) {
  const command = {
    executable: String(args.executable ?? args.command?.executable ?? ''),
    args: Array.isArray(args.args) ? args.args.map(String) : (args.command?.args ?? []).map(String),
    cwdLogical:
      typeof args.cwdLogical === 'string'
        ? args.cwdLogical
        : typeof args.command?.cwdLogical === 'string'
          ? args.command.cwdLogical
          : undefined,
    env: args.env ?? args.command?.env ?? {},
    timeoutMs: args.timeoutMs ?? args.command?.timeoutMs,
  };
  if (!command.executable) {
    throw new AevraToolError('INVALID_REQUEST', 'command executable is required');
  }

  const mode = resolveExecutionMode(context, args.executionMode);
  const original = {
    tool: source?.tool ?? 'command_run',
    args: source
      ? {
          script: source.script,
          shell: source.shell,
          executionMode: mode,
          networkDestinations: args.networkDestinations,
          env: command.env,
          timeoutMs: command.timeoutMs,
          cwdLogical: command.cwdLogical,
        }
      : { ...args, executionMode: mode },
  };
  const classification =
    context.deps.operations?.classify?.([command.executable, ...command.args]) ??
    classifyCommand([command.executable, ...command.args]);
  let risk: RiskTier =
    mode === 'host' && classification.risk === 'LOW' ? 'MEDIUM' : classification.risk;
  if (source) risk = maxRisk(risk, source.riskFloor);

  const classificationFamily = source
    ? `shell:${source.shell}`
    : mode === 'host'
      ? `${classification.family}:host-fallback`
      : classification.family;
  const permissionMatcher = commandPermissionMatcher(
    [command.executable, ...command.args],
    source ? { shell: source.shell, executionMode: mode } : { executionMode: mode },
  );

  const commandGate = await authorizeCapability(
    context,
    sessionId,
    'commands.run',
    original,
    permissionMatcher,
    risk,
  );
  if ('response' in commandGate) return commandGate.response;

  let lease = requiredLease(context, sessionId);
  const session = context.sessions.get(sessionId)!;
  const yoloMode = normalizeYoloMode(
    context.deps.settings?.get<{ mode?: string }>('policy.yolo', { mode: 'workspace' })?.mode,
  );
  const isYolo = Boolean(context.sessions.isYolo?.(sessionId));
  const normalized = {
    family: permissionMatcher,
    capability: 'commands.run' as const,
    risk,
    effect: classification.effect,
    argsHash: argsHash({ command, mode }),
  };

  const rawDestinations = Array.isArray(args.networkDestinations)
    ? args.networkDestinations.map(String)
    : [];
  if (rawDestinations.length > 0 && !lease.capabilities.includes('network') && !isYolo) {
    const networkGate = await authorizeCapability(
      context,
      sessionId,
      'network',
      original,
      '*',
      'MEDIUM',
    );
    if ('response' in networkGate) return networkGate.response;
    lease = requiredLease(context, sessionId);
  }

  let networkPolicy: any = {
    mode: 'deny-all',
    destinations: [],
    enforcement: 'backend',
  };
  let networkApproval: any = null;
  if (rawDestinations.length > 0) {
    const classified = rawDestinations
      .map((value: string) => context.deps.operations?.classifyNetwork?.(value))
      .filter(Boolean);
    networkPolicy = {
      mode: 'allow-rules',
      destinations: classified.map((item: any) => item.destination),
      enforcement: 'backend',
    };
    for (const item of classified) {
      if (item.known || oneTimeAllowed(context, sessionId, 'network', item.family)) {
        continue;
      }
      const decision = context.deps.permissions?.decide({
        capability: 'network',
        matcher: item.family,
        workspaceId: lease.workspaceId,
        actor: session.actor,
        sessionId,
        risk: 'MEDIUM',
      });
      if (decision?.outcome === 'deny' && !isYolo) {
        throw new AevraToolError('CAPABILITY_REQUIRED', decision.reason);
      }
      if (decision?.outcome !== 'allow' && !networkApproval && !isYolo) {
        networkApproval = {
          family: item.family,
          capability: 'network' as const,
          risk: 'MEDIUM' as const,
          argsHash: argsHash(item.destination),
        };
      }
    }
  }

  const commandDecision = context.deps.permissions?.decide({
    capability: 'commands.run',
    matcher: permissionMatcher,
    workspaceId: lease.workspaceId,
    actor: session.actor,
    sessionId,
    risk,
  });

  const commandRequest: CommandRequest = {
    kind: source ? 'script' : 'argv',
    executable: command.executable,
    argv: [command.executable, ...command.args],
    script: source?.script,
    shell: source?.shell as any,
    cwdLogical: command.cwdLogical ?? '/',
    env: command.env,
    timeoutMs: command.timeoutMs,
    executionMode: mode,
    networkDestinations: rawDestinations,
  };

  const { analysis, decision } = await evaluateAndDecideCommand(context, sessionId, {
    commandRequest,
    permissionMatcher,
    rawDestinations,
    isYolo,
    yoloMode,
    networkApproval,
    legacyDecision: commandDecision?.outcome === 'deny' ? commandDecision : undefined,
    riskFloor: risk,
  });

  const payload = {
    tool: 'command_run',
    permissionMatcher,
    classificationFamily,
    commandAnalysis: analysis,
    commandRequest,
    networkApproval,
    riskFloor: risk,
    workspaceId: lease.workspaceId,
    ...(source
      ? {
          sourceTool: 'shell_run',
          shell: source.shell,
          script: source.script,
        }
      : {}),
    args: { command, executionMode: mode, networkPolicy },
  };

  const once = oneTimeAllowed(context, sessionId, 'commands.run', permissionMatcher);
  const effectiveOutcome =
    decision.outcome === 'approval' && once && !analysis.nodes.some((n) => n.risk === 'CRITICAL')
      ? 'allow'
      : decision.outcome;

  const decisionReasons = 'reasons' in decision ? decision.reasons : [];
  if (effectiveOutcome === 'deny') {
    throw new AevraToolError(
      'CAPABILITY_REQUIRED',
      decisionReasons.map((r) => r.message).join('; ') || 'Denied by policy',
    );
  }

  if (effectiveOutcome === 'invalid') {
    throw new AevraToolError(
      'INVALID_REQUEST',
      decisionReasons.map((r) => r.message).join('; ') || 'Invalid command request',
    );
  }

  if (effectiveOutcome === 'approval') {
    if (!context.approvals) {
      throw new AevraToolError('APPROVAL_PENDING', 'Local approval service unavailable');
    }
    const approvalOp = networkApproval ?? normalized;
    const request = await context.approvals.request({
      actor: session.actor,
      sessionId,
      workspaceId: lease.workspaceId,
      operation: approvalOp,
      payload,
      expectedState: {},
      risk: approvalOp.risk,
    });
    bindCommandApproval(request.requestId, analysis, sessionId, lease.workspaceId);
    if (request.status === 'approval_pending') return request;
    return resumeApproval(context, sessionId, request.requestId);
  }

  const commandPayload = { ...command, workspaceId: lease.workspaceId };
  return context.deps.operations!.runCommand(sessionId, commandPayload, mode, networkPolicy);
}
