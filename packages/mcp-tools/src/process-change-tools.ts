import { normalizeYoloMode, type CommandRequest } from '../../protocol/src/index.js';
import { bindCommandApproval } from '../../../apps/core/src/approvals/command-binding.js';
import { classifyCommand } from '../../../apps/core/src/policy/command-family.js';
import { commandPermissionMatcher } from '../../../apps/core/src/policy/command-matcher.js';
import { resumeApproval } from './approval-resume.js';
import { authorizeCapability, gated } from './authorization.js';
import { evaluateAndDecideCommand } from './command-decision-bridge.js';
import { AevraToolError } from './errors.js';
import { argsHash, oneTimeAllowed, requiredLease, unavailable } from './service-helpers.js';
import type { McpRuntimeContext } from './service-types.js';

export const PROCESS_CHANGE_TOOL_NAMES = new Set([
  'process_start',
  'process_list',
  'process_status',
  'process_wait',
  'process_logs',
  'process_stop',
  'process_restart',
  'change_begin',
  'change_status',
  'change_commit',
  'change_rollback',
]);

export async function processStart(context: McpRuntimeContext, sessionId: string, args: any) {
  const session = context.sessions.get(sessionId);
  if (!session) throw new AevraToolError('UNAUTHORIZED', 'Unknown Aevra session');
  const lease = requiredLease(context, sessionId);

  const command = {
    executable: String(args.executable ?? args.command?.executable ?? ''),
    args: Array.isArray(args.args) ? args.args : (args.command?.args ?? []),
    env: args.env ?? args.command?.env ?? {},
    cwdLogical: String(args.cwdLogical ?? args.command?.cwdLogical ?? '/'),
    timeoutMs: args.timeoutMs,
    workspaceId: lease.workspaceId,
  };
  const classification = classifyCommand([command.executable, ...command.args]);
  const permissionMatcher = `process:${commandPermissionMatcher(
    [command.executable, ...command.args],
    { executionMode: 'host' },
  )}`;
  const commandRequest: CommandRequest = {
    kind: 'argv',
    executable: command.executable,
    argv: [command.executable, ...command.args],
    cwdLogical: command.cwdLogical ?? '/',
    env: command.env,
    timeoutMs: command.timeoutMs,
    executionMode: 'host',
    networkDestinations: [],
  };

  const yoloMode = normalizeYoloMode(
    context.deps.settings?.get<{ mode?: string }>('policy.yolo', { mode: 'workspace' })?.mode,
  );
  const isYolo = Boolean(context.sessions.isYolo?.(sessionId));
  const legacyDecision = context.deps.permissions?.decide?.({
    capability: 'commands.run',
    matcher: permissionMatcher,
    workspaceId: lease.workspaceId,
    actor: session.actor,
    sessionId,
    risk: classification.risk,
  });

  const { analysis, decision } = await evaluateAndDecideCommand(context, sessionId, {
    commandRequest,
    permissionMatcher,
    rawDestinations: [],
    isYolo,
    yoloMode,
    legacyDecision: legacyDecision?.outcome === 'deny' ? legacyDecision : undefined,
    riskFloor: classification.risk,
  });

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
      decisionReasons.map((r) => r.message).join('; ') || 'Invalid process request',
    );
  }

  if (effectiveOutcome === 'approval') {
    if (!context.approvals) {
      throw new AevraToolError('APPROVAL_PENDING', 'Local approval service unavailable');
    }
    const operation = {
      family: permissionMatcher,
      capability: 'commands.run' as const,
      risk: classification.risk,
      effect: classification.effect,
      argsHash: argsHash(args),
    };
    const payload = {
      tool: 'process_start',
      permissionMatcher,
      classificationFamily: permissionMatcher,
      commandAnalysis: analysis,
      commandRequest,
      riskFloor: classification.risk,
      workspaceId: lease.workspaceId,
      args,
    };
    const request = await context.approvals.request({
      actor: session.actor,
      sessionId,
      workspaceId: lease.workspaceId,
      operation,
      payload,
      expectedState: {},
      risk: classification.risk,
    });
    bindCommandApproval(request.requestId, analysis, sessionId, lease.workspaceId);
    if (request.status === 'approval_pending') return request;
    return resumeApproval(context, sessionId, request.requestId);
  }

  if (!context.deps.processes) return unavailable('process_start');
  return context.deps.processes.start(
    sessionId,
    lease.workspaceId,
    command,
    args.lifecycle === 'keep-running' ? 'keep-running' : 'stop-with-aevra',
    args.name,
  );
}

async function unwrapProcessResult(result: any, name: string) {
  if (!result) return unavailable(name);
  if (!result.ok) {
    throw new AevraToolError(result.error.code, result.error.message, result.error.details);
  }
  return result.value;
}

export async function handleProcessChangeTool(
  context: McpRuntimeContext,
  sessionId: string,
  name: string,
  args: any,
) {
  if (name === 'process_start') return processStart(context, sessionId, args);
  if (name === 'process_list') {
    if (!context.deps.processes) return unavailable(name);
    return { result: await context.deps.processes.list(sessionId, context.workspaceId) };
  }
  if (name === 'process_status') {
    return unwrapProcessResult(
      context.workspaceId
        ? await context.deps.processes?.status(
            sessionId,
            context.workspaceId,
            String(args.processId),
          )
        : await context.deps.processes?.status(sessionId, String(args.processId)),
      name,
    );
  }
  if (name === 'process_wait') {
    const timeoutMs = args.timeoutMs === undefined ? undefined : Number(args.timeoutMs);
    const result = context.workspaceId
      ? await context.deps.processes?.wait(
          sessionId,
          context.workspaceId,
          String(args.processId),
          timeoutMs,
        )
      : await context.deps.processes?.wait(sessionId, String(args.processId), timeoutMs);
    return unwrapProcessResult(result, name);
  }
  if (name === 'process_logs' || name === 'process_stop' || name === 'process_restart') {
    const kind = name.replace('_', '.') as 'process.logs' | 'process.stop' | 'process.restart';
    return unwrapProcessResult(
      context.workspaceId
        ? await context.deps.processes?.command(
            sessionId,
            context.workspaceId,
            kind,
            String(args.processId),
            args.cursor,
          )
        : await context.deps.processes?.command(
            sessionId,
            kind,
            String(args.processId),
            args.cursor,
          ),
      name,
    );
  }

  if (name === 'change_begin') {
    const lease = requiredLease(context, sessionId);
    return (
      context.deps.changes?.begin(sessionId, lease.workspaceId, args.name) ?? unavailable(name)
    );
  }
  if (name === 'change_status') {
    return (
      context.deps.changes?.status(String(args.changeSetId ?? ''), sessionId) ?? unavailable(name)
    );
  }
  if (name === 'change_commit') {
    return context.deps.changes?.commit(String(args.changeSetId)) ?? unavailable(name);
  }
  if (name === 'change_rollback') {
    const gate = await authorizeCapability(
      context,
      sessionId,
      'files.write',
      { tool: name, args },
      '*',
      'HIGH',
    );
    if ('response' in gate) return gate.response;
    return gated(
      context,
      sessionId,
      {
        family: 'change:rollback',
        capability: 'files.write',
        risk: 'HIGH',
        argsHash: argsHash(args),
      },
      { tool: name, args },
      {},
      () =>
        context.deps.changes!.rollback(String(args.changeSetId), {
          force: false,
          skipPaths: [],
        }),
    );
  }

  return unavailable(name);
}
