import type { WorkspaceSummary } from '@aevra/admin-contracts';
import {
  installAgents,
  type AgentChange,
  type AgentScope,
  type AgentTransport,
} from './agent-service';

/** One (agent, workspace) outcome; `workspaceId` is absent for the global scope. */
export interface PairResult {
  target: string;
  workspaceId?: string;
  ok: boolean;
  error?: string;
}

export interface PlannedChange extends AgentChange {
  workspaceId?: string;
}

export interface RunOutput {
  results: PairResult[];
  changes: PlannedChange[];
  notes: string[];
}

function reason(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause);
}

function workspaceName(workspaces: WorkspaceSummary[], id: string | undefined) {
  if (!id) return undefined;
  return workspaces.find((workspace) => workspace.id === id)?.name ?? id;
}

export function pairLabel(target: string, workspaces: WorkspaceSummary[], id: string | undefined) {
  const name = workspaceName(workspaces, id);
  return name ? `${target} (${name})` : target;
}

export function isOk(results: PairResult[], target: string, workspaceId: string | undefined) {
  return results.some(
    (item) => item.ok && item.target === target && item.workspaceId === workspaceId,
  );
}

/**
 * The admin API installs one workspace per request, so workspace scope issues one request per
 * selected workspace, in order. Pairs already installed are skipped. A dry run (or the global
 * scope) lets a thrown request propagate; a real workspace install turns it into failed results
 * for that workspace so the remaining workspaces still run.
 */
export async function runInstall(input: {
  targets: string[];
  scope: AgentScope;
  workspaceIds: string[];
  transport: AgentTransport;
  done: PairResult[];
  dryRun: boolean;
}): Promise<RunOutput> {
  const output: RunOutput = { results: [], changes: [], notes: [] };
  const perWorkspace = input.scope === 'workspace';
  const units = perWorkspace ? input.workspaceIds : [undefined];
  for (const unit of units) {
    const targets = input.targets.filter((target) => !isOk(input.done, target, unit));
    if (!targets.length) continue;
    const tag = unit ? { workspaceId: unit } : {};
    try {
      const response = await installAgents({
        targets,
        scope: input.scope,
        ...tag,
        transport: input.transport,
        ...(input.dryRun ? { dryRun: true } : {}),
      });
      for (const item of response.results) {
        output.results.push({
          target: item.target,
          ...tag,
          ok: item.ok,
          ...(item.error === undefined ? {} : { error: item.error }),
        });
      }
      for (const change of response.changes) output.changes.push({ ...change, ...tag });
      for (const note of response.notes) if (!output.notes.includes(note)) output.notes.push(note);
    } catch (cause) {
      if (input.dryRun || !perWorkspace) throw cause;
      for (const target of targets) {
        output.results.push({ target, ...tag, ok: false, error: reason(cause) });
      }
    }
  }
  return output;
}
