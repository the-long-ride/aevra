import { classifyCommand } from '../../../apps/core/src/policy/command-family.js';
import { commandPermissionMatcher } from '../../../apps/core/src/policy/command-matcher.js';
import { authorizeCapability, gated } from './authorization.js';
import { AevraToolError } from './errors.js';
import { argsHash, requiredLease, unavailable } from './service-helpers.js';
import type { McpRuntimeContext } from './service-types.js';

export const PROCESS_CHANGE_TOOL_NAMES = new Set([
  'process_start',
  'process_list',
  'process_logs',
  'process_stop',
  'process_restart',
  'change_begin',
  'change_status',
  'change_commit',
  'change_rollback',
]);

export async function processStart(context: McpRuntimeContext, sessionId: string, args: any) {
  const command = {
    executable: String(args.executable ?? args.command?.executable ?? ''),
    args: Array.isArray(args.args) ? args.args : (args.command?.args ?? []),
    env: args.env ?? args.command?.env ?? {},
    cwdLogical: '/',
    timeoutMs: args.timeoutMs,
  };
  const classification = classifyCommand([command.executable, ...command.args]);
  const permissionMatcher = `process:${commandPermissionMatcher(
    [command.executable, ...command.args],
    { executionMode: 'host' },
  )}`;
  const gate = await authorizeCapability(
    context,
    sessionId,
    'commands.run',
    { tool: 'process_start', args },
    permissionMatcher,
    classification.risk,
  );
  if ('response' in gate) return gate.response;

  return gated(
    context,
    sessionId,
    {
      family: permissionMatcher,
      capability: 'commands.run',
      risk: classification.risk,
      effect: classification.effect,
      argsHash: argsHash(args),
    },
    { tool: 'process_start', permissionMatcher, args },
    {},
    () =>
      context.deps.processes!.start(
        sessionId,
        command,
        args.lifecycle === 'keep-running' ? 'keep-running' : 'stop-with-aevra',
      ),
  );
}

export async function handleProcessChangeTool(
  context: McpRuntimeContext,
  sessionId: string,
  name: string,
  args: any,
) {
  if (name === 'process_start') return processStart(context, sessionId, args);
  if (name === 'process_list') {
    return context.deps.processes?.list(sessionId) ?? unavailable(name);
  }
  if (name === 'process_logs' || name === 'process_stop' || name === 'process_restart') {
    const kind = name.replace('_', '.') as 'process.logs' | 'process.stop' | 'process.restart';
    const result = await context.deps.processes?.command(
      sessionId,
      kind,
      String(args.processId),
      args.cursor,
    );
    if (!result) return unavailable(name);
    if (!result.ok) {
      throw new AevraToolError(result.error.code, result.error.message, result.error.details);
    }
    return result.value;
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
