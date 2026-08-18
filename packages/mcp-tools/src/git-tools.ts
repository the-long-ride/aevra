import type { Capability } from '../../protocol/src/index.js';
import type { WorkerOperation } from '../../protocol/src/worker.js';
import { classifyOperationRisk } from '../../../apps/core/src/policy/risk.js';
import { authorizeCapability, gated } from './authorization.js';
import { AevraToolError } from './errors.js';
import { repoState } from './git-state.js';
import { argsHash, requiredLease } from './service-helpers.js';
import type { McpRuntimeContext } from './service-types.js';

export const GIT_TOOL_NAMES = new Set([
  'git_status',
  'git_diff',
  'git_log',
  'git_branch',
  'git_commit',
  'git_push',
]);

export async function gitTool(
  context: McpRuntimeContext,
  sessionId: string,
  name: string,
  args: any,
) {
  const capability: Capability =
    name === 'git_commit'
      ? 'git.commit'
      : name === 'git_push'
        ? 'git.push'
        : 'git.read';
  const matcher = capability === 'git.read' ? '*' : name.replace('_', ':');
  const risk = classifyOperationRisk(name.replace('_', ':'), args.args ?? []);
  const gate = await authorizeCapability(
    context,
    sessionId,
    capability,
    { tool: name, args },
    matcher,
    risk,
  );
  if ('response' in gate) return gate.response;

  const lease = requiredLease(context, sessionId);
  const roots = context.workspaces.capabilityRoots(lease.workspaceId);
  const operation: WorkerOperation =
    name === 'git_status'
      ? { kind: 'git.status' }
      : name === 'git_diff'
        ? { kind: 'git.diff', args: args.args ?? [] }
        : name === 'git_log'
          ? { kind: 'git.log', args: args.args ?? [] }
          : name === 'git_branch'
            ? { kind: 'git.branch', args: args.args ?? [] }
            : name === 'git_commit'
              ? {
                  kind: 'git.commit',
                  message: String(args.message),
                  args: args.args ?? [],
                }
              : {
                  kind: 'git.push',
                  remote: args.remote,
                  branch: args.branch,
                  args: args.args ?? [],
                };

  const execute = async () => {
    const result = await context.worker.execute({
      sessionId,
      workspaceId: lease.workspaceId,
      roots,
      operation,
      executionMode: 'host',
    });
    if (!result.ok) {
      throw new AevraToolError(
        result.error.code,
        result.error.message,
        result.error.details,
      );
    }
    return result.value;
  };
  if (risk === 'LOW') return execute();

  const expectedState = await repoState(
    context,
    sessionId,
    lease.workspaceId,
    roots,
  );
  return gated(
    context,
    sessionId,
    {
      family: name.replace('_', ':'),
      capability,
      risk,
      argsHash: argsHash(args),
    },
    { tool: name, args },
    expectedState,
    execute,
  );
}
