import type { ExecutionMode, RiskTier } from '../../protocol/src/index.js';
import { classifyCommand } from '../../../apps/core/src/policy/command-family.js';
import {
  commandPermissionMatcher,
  needsCommandPermissionApproval,
} from '../../../apps/core/src/policy/command-matcher.js';
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
  if (rawDestinations.length > 0 && !lease.capabilities.includes('network')) {
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
      if (decision?.outcome === 'deny') {
        throw new AevraToolError('CAPABILITY_REQUIRED', decision.reason);
      }
      if (decision?.outcome !== 'allow' && !networkApproval) {
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
  if (commandDecision?.outcome === 'deny') {
    throw new AevraToolError('CAPABILITY_REQUIRED', commandDecision.reason);
  }
  const once = oneTimeAllowed(context, sessionId, 'commands.run', permissionMatcher);
  const needsCommandApproval = needsCommandPermissionApproval(commandDecision?.outcome, once);
  const approvalNormalized = needsCommandApproval ? normalized : networkApproval;
  const payload = {
    tool: 'command_run',
    permissionMatcher,
    classificationFamily,
    ...(source
      ? {
          sourceTool: 'shell_run',
          shell: source.shell,
          script: source.script,
        }
      : {}),
    args: { command, executionMode: mode, networkPolicy },
  };

  if (approvalNormalized) {
    if (!context.approvals) {
      throw new AevraToolError('APPROVAL_PENDING', 'Local approval service unavailable');
    }
    const request = await context.approvals.request({
      actor: session.actor,
      sessionId,
      workspaceId: lease.workspaceId,
      operation: approvalNormalized,
      payload,
      expectedState: {},
      risk: approvalNormalized.risk,
    });
    if (request.status === 'approval_pending') return request;
    return resumeApproval(context, sessionId, request.requestId);
  }

  return context.deps.operations!.runCommand(sessionId, command, mode, networkPolicy);
}
