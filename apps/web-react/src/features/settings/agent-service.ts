import type { WorkspaceSummary } from '@aevra/admin-contracts';
import { requestJson } from '../../services/api-client';

export type AgentScope = 'user' | 'workspace';
export type AgentTransport = 'stdio' | 'http';

export interface AgentRegistration {
  target: string;
  scope: AgentScope;
  workspaceRoot?: string;
  workspaceId?: string;
  transport: AgentTransport;
  state?: 'installed' | 'incomplete' | 'conflict';
  config: string;
  credentialId: string;
  lastUsedAt: string | null;
  // The connector this registration issued is gone (revoked or deleted elsewhere).
  connectorMissing?: boolean;
}

export interface DetectedAgent {
  target: string;
  found: boolean;
  evidence: 'path' | 'config' | 'none';
  configPath: string;
  scopes: AgentScope[];
}

export interface AgentChange {
  target: string;
  file: string;
  action: 'create' | 'update' | 'remove';
}

export interface AgentTargetResult {
  target: string;
  ok: boolean;
  message?: string;
  error?: string;
}

export interface AgentInstallResponse {
  results: AgentTargetResult[];
  registrations: AgentRegistration[];
  notes: string[];
  changes: AgentChange[];
  message: string;
}

export interface AgentInstallInput {
  targets: string[];
  scope: AgentScope;
  workspaceId?: string;
  transport: AgentTransport;
  dryRun?: boolean;
}

// The core also returns credential file paths and hashes. The UI never needs them, so drop them
// here and keep them out of component state.
function publicRegistration(value: AgentRegistration): AgentRegistration {
  const { target, scope, workspaceRoot, workspaceId, transport, state, config } = value;
  return {
    target,
    scope,
    ...(workspaceRoot ? { workspaceRoot } : {}),
    ...(workspaceId ? { workspaceId } : {}),
    transport,
    ...(state ? { state } : {}),
    config,
    credentialId: value.credentialId,
    lastUsedAt: value.lastUsedAt ?? null,
    ...(value.connectorMissing ? { connectorMissing: true } : {}),
  };
}

export async function loadAgents(): Promise<{ registrations: AgentRegistration[] }> {
  const value = await requestJson<{ registrations?: AgentRegistration[] }>('/api/agents');
  return { registrations: (value.registrations ?? []).map(publicRegistration) };
}

export function detectAgents(): Promise<DetectedAgent[]> {
  return requestJson<DetectedAgent[]>('/api/agents/detect');
}

export function loadWorkspaces(): Promise<WorkspaceSummary[]> {
  return requestJson<WorkspaceSummary[]>('/api/workspaces');
}

// An older core answers without per-target results (and may omit notes or changes): fill them
// in so callers can rely on the shape. Restarting the core gives the full response.
async function post(body: Record<string, unknown>): Promise<AgentInstallResponse> {
  const value = await requestJson<Partial<AgentInstallResponse>>('/api/agents', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  const message = value.message ?? '';
  return {
    ...value,
    message,
    results: value.results ?? [{ target: 'all', ok: true, message }],
    registrations: value.registrations ?? [],
    notes: value.notes ?? [],
    changes: value.changes ?? [],
  };
}

export function installAgents(input: AgentInstallInput): Promise<AgentInstallResponse> {
  return post({
    operation: 'install',
    targets: input.targets,
    scope: input.scope,
    ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
    transport: input.transport,
    ...(input.dryRun ? { dryRun: true } : {}),
  });
}

// A workspace registration without a known Aevra workspace (folder deleted or no longer
// registered) is removed by the credential id it issued; core matches it in the manifest.
export function uninstallAgent(
  registration: Pick<AgentRegistration, 'target' | 'scope' | 'workspaceId' | 'credentialId'>,
): Promise<AgentInstallResponse> {
  if (registration.scope === 'workspace' && !registration.workspaceId)
    return post({ operation: 'uninstall', credentialId: registration.credentialId });
  return post({
    operation: 'uninstall',
    targets: [registration.target],
    scope: registration.scope,
    ...(registration.workspaceId ? { workspaceId: registration.workspaceId } : {}),
  });
}
