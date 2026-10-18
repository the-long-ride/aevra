import type { AdminRequestInit } from '../admin-session.js';
import type { AgentCliCommand } from '../agent-args.js';
import type { AevraCommand } from '../args.js';
import {
  buildAgentRows,
  formatAgentTable,
  formatDetectedList,
  formatInstallSummary,
  formatOrphans,
  redactRegistrations,
  type AgentApiResponse,
  type DetectedRow,
  type SummaryCommand,
} from './agent-format.js';

interface ResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export interface AgentCommandDependencies {
  api(path: string, init?: AdminRequestInit): Promise<ResponseLike>;
  log(message: string): void;
  error(message: string): void;
  formatError(error: unknown): string;
  isInteractive(): boolean;
  confirm(question: string): Promise<boolean>;
  workspaces(): Promise<Array<{ id: string; name: string }>>;
}

const CONNECTIVITY = new Set(['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'ETIMEDOUT', 'EPIPE']);

async function failureMessage(response: ResponseLike): Promise<string> {
  try {
    const { error } = (await response.json()) as { error?: { code?: string; message?: string } };
    const { code, message } = error ?? {};
    if (message) return code && !message.includes(code) ? `${code}: ${message}` : message;
    if (code) return code;
  } catch {
    // Fall through to the status-only message.
  }
  return `Core returned ${response.status}`;
}

async function fetchJson<T>(deps: AgentCommandDependencies, path: string): Promise<T> {
  const response = await deps.api(path, { method: 'GET' });
  if (!response.ok) throw new Error(await failureMessage(response));
  return (await response.json()) as T;
}

async function post(
  deps: AgentCommandDependencies,
  body: Record<string, unknown>,
): Promise<AgentApiResponse> {
  const response = await deps.api('/api/agents', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await failureMessage(response));
  return (await response.json()) as AgentApiResponse;
}

const OLDER_CORE =
  'the running core may be older than this CLI. Check GET /api/health and restart aevra start.';
const SKEW_HINT = `The response carried no per-agent results: ${OLDER_CORE}`;

// An older core does not serve agent detection: say so instead of printing a bare 404.
class CoreSkewError extends Error {}

async function detect(deps: AgentCommandDependencies): Promise<DetectedRow[]> {
  const response = await deps.api('/api/agents/detect', { method: 'GET' });
  if (response.status === 404)
    throw new CoreSkewError(`GET /api/agents/detect is not served: ${OLDER_CORE}`);
  if (!response.ok) throw new Error(await failureMessage(response));
  return (await response.json()) as DetectedRow[];
}

// Prints the outcome of a mutating call and returns the exit code. A response without
// `results` comes from an older core: its message is shown, and without one the outcome
// is unknown, which is a failure.
function present(
  deps: AgentCommandDependencies,
  response: AgentApiResponse,
  summary: SummaryCommand,
  json: boolean,
): number {
  const legacy = response.results === undefined;
  if (json) deps.log(JSON.stringify(redactRegistrations(response), null, 2));
  else if (!legacy) deps.log(formatInstallSummary(response, summary));
  else if (response.message) deps.log(response.message);
  if (legacy && !response.message) {
    deps.error(`[aevra] ${SKEW_HINT}`);
    return 1;
  }
  return response.results?.some((row) => row.ok === false) ? 1 : 0;
}

function report(deps: AgentCommandDependencies, label: string, error: unknown): number {
  const code = (error as { code?: string } | null)?.code;
  const hint = CONNECTIVITY.has(String(code ?? '')) ? '. Is aevra start/service running?' : '';
  deps.error(`[aevra] ${label} failed: ${deps.formatError(error)}${hint}`);
  return 1;
}

async function resolveWorkspace(deps: AgentCommandDependencies, wanted: string): Promise<string> {
  const rows = await deps.workspaces();
  const byId = rows.find((row) => row.id === wanted);
  if (byId) return byId.id;
  const named = rows.filter((row) => row.name.toLowerCase() === wanted.toLowerCase());
  if (named.length > 1) throw new Error(`Several workspaces are named ${wanted}: use its id`);
  if (named[0]) return named[0].id;
  const known = rows.map((row) => row.name).join(', ') || 'none registered';
  throw new Error(`Unknown workspace: ${wanted} (known: ${known})`);
}

async function list(command: AgentCliCommand, deps: AgentCommandDependencies): Promise<number> {
  const detected = await detect(deps);
  const status = await fetchJson<AgentApiResponse>(deps, '/api/agents');
  if (command.json) {
    deps.log(JSON.stringify(redactRegistrations({ ...status, detected }), null, 2));
    return 0;
  }
  const registrations = status.registrations ?? [];
  const names = new Map<string, string>();
  if (registrations.some((reg) => reg.scope === 'workspace'))
    try {
      for (const row of await deps.workspaces()) names.set(row.id, row.name);
    } catch {
      // Names are a convenience: fall back to the folder name.
    }
  deps.log(formatAgentTable(buildAgentRows(detected, registrations, names)));
  const orphans = formatOrphans(registrations);
  if (orphans) deps.log(orphans);
  return 0;
}

// Returns the agents to act on, or a process exit code when the run must stop.
async function detectedTargets(
  command: AgentCliCommand,
  deps: AgentCommandDependencies,
): Promise<string[] | number> {
  const found = (await detect(deps)).filter((row) => row.found);
  if (!found.length) {
    deps.error(
      '[aevra] No supported agents detected. Name an agent to connect it anyway, for example: aevra agent install codex',
    );
    return 1;
  }
  // With --json stdout must stay one JSON document, so the human text goes to stderr.
  const note = (message: string) => (command.json ? deps.error(message) : deps.log(message));
  note(formatDetectedList(found));
  // Naming `all` is consent; a bare install must be confirmed unless it only previews.
  if (command.targets.length === 0 && !command.yes && !command.dryRun) {
    if (!deps.isInteractive()) {
      deps.error(
        '[aevra] Not a terminal: pass --yes to connect the detected agents, or name them.',
      );
      return 1;
    }
    if (!(await deps.confirm('Proceed? [y/N]'))) {
      note('Cancelled. Nothing was changed.');
      return 1;
    }
  }
  return found.map((row) => row.target);
}

async function change(command: AgentCliCommand, deps: AgentCommandDependencies): Promise<number> {
  const install = command.action === 'install';
  const workspaceId =
    command.workspace === undefined ? undefined : await resolveWorkspace(deps, command.workspace);
  let targets: string[] = command.targets;
  if (install && (targets.length === 0 || targets.includes('all'))) {
    const chosen = await detectedTargets(command, deps);
    if (typeof chosen === 'number') return chosen;
    targets = chosen;
  }
  // Uninstall of `all` with no scope is sent as the single `all` target with scope `all`: core
  // removes every registration, agent by agent. With a scope the targets go as given (`['all']`
  // included) and only that scope is touched. `--id` names exactly one registration.
  const sweep = !install && targets.includes('all') && command.scope === undefined;
  const response = await post(deps, {
    operation: command.action,
    ...(command.id !== undefined
      ? { credentialId: command.id }
      : sweep
        ? { target: 'all', scope: 'all' }
        : { targets }),
    ...(install || command.scope ? { scope: command.scope ?? 'user' } : {}),
    ...(workspaceId ? { workspaceId } : {}),
    transport: command.transport,
    dryRun: command.dryRun,
  });
  return present(
    deps,
    response,
    {
      action: command.action as 'install' | 'uninstall',
      targets: command.targets,
      ...(command.scope ? { scope: command.scope } : {}),
      ...(command.workspace ? { workspace: command.workspace } : {}),
      ...(command.id !== undefined ? { id: command.id } : {}),
      dryRun: command.dryRun,
    },
    command.json,
  );
}

export async function runAgentCommand(
  command: AgentCliCommand,
  deps: AgentCommandDependencies,
): Promise<number> {
  try {
    return command.action === 'list' ? await list(command, deps) : await change(command, deps);
  } catch (error) {
    if (error instanceof CoreSkewError) {
      deps.error(`[aevra] ${error.message}`);
      return 1;
    }
    return report(deps, 'agent', error);
  }
}

export async function runRootUninstall(
  command: Extract<AevraCommand, { command: 'uninstall' }>,
  deps: AgentCommandDependencies,
  root: { cleanup(purge: boolean, dryRun: boolean): Promise<{ message?: string }> },
): Promise<number> {
  try {
    const response = await post(deps, {
      operation: 'uninstall',
      target: 'all',
      scope: 'all',
      transport: 'stdio',
      dryRun: command.dryRun,
    });
    const code = present(
      deps,
      response,
      { action: 'uninstall', targets: ['all'], dryRun: command.dryRun },
      false,
    );
    // Cleanup can purge state: only run it once the agent removal is known to have worked.
    if (code !== 0) return code;
    const cleanup = await root.cleanup(command.purge, command.dryRun);
    if (cleanup.message) deps.log(cleanup.message);
    return 0;
  } catch (error) {
    return report(deps, 'uninstall', error);
  }
}
