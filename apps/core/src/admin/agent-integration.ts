import { mkdirSync } from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { detectAgents } from '../../../../packages/agent-integration/src/detect.js';
import { manageAgent } from '../../../../packages/agent-integration/src/manage.js';
import {
  AGENT_TARGETS,
  type AgentChange,
  type AgentOptions,
  type AgentResult,
  type AgentTarget,
  type CredentialAdapter,
} from '../../../../packages/agent-integration/src/types.js';
import type { CoreConfig } from '../config.js';
import { localTlsPaths } from '../tls/local-tls.js';
import type { ConnectorRepository } from '../../../../packages/store/src/connectors.js';
import type { SessionManager } from '../sessions/session-manager.js';
import { tryMarkStateDirectory } from '../../../../packages/agent-integration/src/cleanup.js';

export interface AgentTargetResult {
  target: string;
  ok: boolean;
  message?: string;
  error?: string;
}
export type AgentIntegrationResult = AgentResult & { results: AgentTargetResult[] };

// Marks the state folder before anything is written to it, so a purge later knows whether
// Aevra created it. A marker problem is reported and never stops core from starting.
export function prepareStateDirectory(
  config: Pick<CoreConfig, 'stateDir'>,
  env: NodeJS.ProcessEnv = process.env,
  home = os.homedir(),
): void {
  const problem = tryMarkStateDirectory(config.stateDir, 'aevra', home, !env.AEVRA_STATE_DIR);
  if (problem) console.warn(`Aevra state ownership not recorded: ${problem}`);
  mkdirSync(config.stateDir, { recursive: true, mode: 0o700 });
}

export function agentAdminContext(
  config: CoreConfig,
  connectors: ConnectorRepository,
  sessions: Pick<SessionManager, 'revokeConnection'>,
  close: () => Promise<void>,
) {
  return {
    stopCore() {
      if (process.listenerCount('SIGTERM')) process.emit('SIGTERM');
      else void close();
    },
    agents: createAgentIntegration(config, {
      async create(name) {
        const issued = connectors.create({ name });
        return { id: issued.connector.id, token: issued.token };
      },
      async revoke(id) {
        connectors.revoke(id);
        sessions.revokeConnection(id, 'AGENT_UNINSTALL');
      },
    }),
  };
}

function invalid(reason: string): Error {
  return new Error(`AGENT_OPTIONS_INVALID: ${reason}`);
}

function validTarget(value: unknown): boolean {
  return value === 'all' || AGENT_TARGETS.includes(value as AgentTarget);
}

type Where = Pick<AgentOptions, 'scope' | 'workspaceRoot' | 'credentialId'>;

export function createAgentIntegration(
  config: CoreConfig,
  credentials: CredentialAdapter,
  home = os.homedir(),
  env: NodeJS.ProcessEnv = process.env,
) {
  const build = (
    operation: AgentOptions['operation'],
    target: AgentOptions['target'],
    transport: AgentOptions['transport'],
    dryRun: boolean,
    where: Where = {},
  ): AgentOptions => ({
    home,
    env,
    product: 'aevra',
    stateDir: config.stateDir,
    operation,
    target,
    transport,
    dryRun,
    ...where,
    executable: process.execPath,
    entrypoint: fileURLToPath(new URL('../../../cli/src/cli.js', import.meta.url)),
    endpoint: `https://localhost:${config.mcpPort}/mcp`,
    caFile:
      config.tlsCaPath ??
      (config.tlsCertPath ? config.tlsCertPath : localTlsPaths(config.stateDir).certificatePath),
    credentials,
  });
  const status = (transport: AgentOptions['transport'] = 'stdio') =>
    manageAgent(build('status', 'all', transport, false));
  const withResults = (result: AgentResult, target: string): AgentIntegrationResult => ({
    ...result,
    results: [{ target, ok: true, message: result.message }],
  });

  // One registration, chosen by the credential id it issued: works for a workspace whose folder
  // is gone or that is no longer registered in Aevra. The id is matched, never used as a path.
  async function uninstallById(
    value: Record<string, unknown>,
    transport: AgentOptions['transport'],
    dryRun: boolean,
  ) {
    const id = value.credentialId;
    if (value.operation !== 'uninstall') throw invalid('credentialId is only for uninstall');
    if (typeof id !== 'string' || !id.trim())
      throw invalid('credentialId must name a registration');
    if (
      value.targets !== undefined ||
      value.scope !== undefined ||
      value.workspaceRoot !== undefined
    )
      throw invalid('credentialId cannot be combined with targets, a scope or a workspace');
    // The engine matches the id in the manifest (and refuses an unknown one); the result names
    // the target of the registration it removed, so no status pass is needed to learn it.
    const options = build('uninstall', 'all', transport, dryRun, { credentialId: id });
    const result = await manageAgent(options);
    return withResults(result, result.removed?.[0] ?? 'registration');
  }

  return async (input: unknown) => {
    const value = input as Record<string, unknown> | null;
    if (value?.operation === 'detect') return detectAgents({ home, env });
    const operation = value?.operation as AgentOptions['operation'];
    const transport = (value?.transport ?? 'stdio') as AgentOptions['transport'];
    const dryRun = value?.dryRun ?? false;
    const listed = value?.targets;
    if (!value || !['install', 'uninstall', 'status'].includes(operation))
      throw invalid('unknown operation');
    if (!['stdio', 'http'].includes(transport)) throw invalid('unknown transport');
    if (typeof dryRun !== 'boolean') throw invalid('dryRun must be a boolean');
    if (value.credentialId !== undefined) return uninstallById(value, transport, dryRun);
    // A single `target: 'all'` uninstall without a scope keeps its meaning (every scope); any
    // explicit scope is passed on as given, so `user` never sweeps workspace registrations.
    const sweep = operation === 'uninstall' && listed === undefined && value.target === 'all';
    const scope = value.scope ?? (sweep ? 'all' : 'user');
    if (scope !== 'user' && scope !== 'workspace' && scope !== 'all')
      throw invalid('unknown scope');
    if (scope === 'all' && operation === 'install')
      throw invalid('scope all is only for uninstall');
    if (listed === undefined ? !validTarget(value.target) : !Array.isArray(listed))
      throw invalid('target must name a known agent');
    if (Array.isArray(listed) && (!listed.length || !listed.every(validTarget)))
      throw invalid('targets must name known agents');
    let where: Where = { scope };
    if (scope === 'workspace') {
      if (transport !== 'stdio') throw invalid('workspace scope requires the stdio transport');
      if (typeof value.workspaceRoot !== 'string' || !value.workspaceRoot.trim())
        throw invalid('workspace scope requires a workspace folder');
      where = { scope, workspaceRoot: value.workspaceRoot };
    }
    if (operation === 'status') return withResults(await status(transport), 'all');
    // `target` alone keeps the single-call behaviour; `targets`, and an uninstall of `all`, run
    // each agent independently, so one failing agent does not stop the others.
    if (listed === undefined && !sweep) {
      const target = value.target as AgentOptions['target'];
      const result = await manageAgent(build(operation, target, transport, dryRun, where));
      return withResults(result, String(target));
    }
    const names = (listed ?? ['all']) as string[];
    const targets = [
      ...new Set(names.flatMap((t) => (t === 'all' ? [...AGENT_TARGETS] : [t]))),
    ] as AgentTarget[];
    const results: AgentTargetResult[] = [];
    const notes = new Set<string>();
    const changes: AgentChange[] = [];
    let latest: AgentResult | undefined;
    for (const target of targets) {
      try {
        const result = await manageAgent(build(operation, target, transport, dryRun, where));
        latest = result;
        results.push({ target, ok: true, message: result.message });
        for (const note of result.notes) notes.add(note);
        changes.push(...result.changes);
      } catch (error) {
        results.push({ target, ok: false, error: (error as Error).message });
      }
    }
    let registrations = latest?.registrations ?? [];
    try {
      registrations = (await status()).registrations;
    } catch {
      // Keep the last known registrations: per-target results must still reach the caller.
    }
    const succeeded = results.filter((row) => row.ok).length;
    return {
      dryRun,
      registrations,
      message: `Agent ${operation}: ${succeeded} of ${results.length} succeeded`,
      notes: [...notes],
      changes,
      results,
    } satisfies AgentIntegrationResult;
  };
}
