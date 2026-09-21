import { classifyCommand } from '../../../apps/core/src/policy/command-family.js';
import { commandPermissionMatcher } from '../../../apps/core/src/policy/command-matcher.js';
import { normalizeYoloMode, type CommandRequest, type RiskTier } from '../../protocol/src/index.js';
import { evaluateAndDecideCommand } from './command-decision-bridge.js';
import { AevraToolError } from './errors.js';
import { maxRisk } from './service-helpers.js';
import type { McpRuntimeContext } from './service-types.js';
import { buildShellCommand, resolveShellKind, shellRiskFloor } from './shell-command.js';

export async function evaluateRuntimeCommand(
  context: McpRuntimeContext,
  sessionId: string,
  workspaceId: string | undefined,
  rawRequest: CommandRequest,
) {
  const session = context.sessions.get(sessionId);
  if (!session) throw new AevraToolError('UNAUTHORIZED', 'Unknown Aevra session');

  const lease = workspaceId
    ? context.sessions.leaseForWorkspace(sessionId, workspaceId)
    : context.sessions.activeLease(sessionId);
  if (!lease) {
    throw new AevraToolError('WORKSPACE_ACCESS_REQUIRED', 'Workspace access required');
  }

  const scopedContext = { ...context, workspaceId: lease.workspaceId } as McpRuntimeContext;
  let request = { ...rawRequest } as CommandRequest;
  let matcher: string;
  let risk: RiskTier;
  let riskFloor: RiskTier | undefined;

  if (request.kind === 'script') {
    const mode = request.executionMode;
    const recommendedShell = context.deps.systemCapabilities?.os.recommendedShell;
    const shell = resolveShellKind(
      {
        script: String(request.script ?? ''),
        shell: request.shell as any,
        executionMode: mode,
        timeoutMs: request.timeoutMs,
        env: request.env,
        cwdLogical: request.cwdLogical,
      },
      process.platform,
      recommendedShell,
    );
    const command = buildShellCommand(
      {
        script: String(request.script ?? ''),
        shell,
        executionMode: mode,
        timeoutMs: request.timeoutMs,
        env: request.env,
        cwdLogical: request.cwdLogical,
      },
      process.platform,
      recommendedShell,
    );
    request = {
      ...request,
      executable: command.executable,
      argv: [command.executable, ...(command.args ?? [])],
      shell: shell as any,
      cwdLogical: command.cwdLogical ?? request.cwdLogical ?? '/',
      env: command.env ?? request.env ?? {},
      timeoutMs: command.timeoutMs ?? request.timeoutMs,
    };
    matcher = commandPermissionMatcher(request.argv ?? [], { shell, executionMode: mode });
    const classification =
      context.deps.operations?.classify?.(request.argv ?? []) ??
      classifyCommand(request.argv ?? []);
    risk = maxRisk(
      mode === 'host' && classification.risk === 'LOW' ? 'MEDIUM' : classification.risk,
      shellRiskFloor(mode),
    );
    riskFloor = risk;
  } else {
    const argv = request.argv ?? (request.executable ? [request.executable] : []);
    matcher = commandPermissionMatcher(argv, { executionMode: request.executionMode });
    const classification = context.deps.operations?.classify?.(argv) ?? classifyCommand(argv);
    risk =
      request.executionMode === 'host' && classification.risk === 'LOW'
        ? 'MEDIUM'
        : classification.risk;
    riskFloor = risk;
  }

  const legacyDecision = context.deps.permissions?.decide({
    capability: 'commands.run',
    matcher,
    workspaceId: lease.workspaceId,
    actor: session.actor,
    sessionId,
    risk,
  });

  const rawDestinations = request.networkDestinations ?? [];

  const yoloMode = normalizeYoloMode(
    context.deps.settings?.get<{ mode?: string }>('policy.yolo', { mode: 'workspace' })?.mode,
  );
  const result = await evaluateAndDecideCommand(scopedContext, sessionId, {
    commandRequest: request,
    permissionMatcher: matcher,
    rawDestinations,
    isYolo: Boolean(context.sessions.isYolo?.(sessionId)),
    yoloMode,
    legacyDecision: legacyDecision?.outcome === 'deny' ? legacyDecision : undefined,
    riskFloor,
  });
  return { request, ...result };
}
