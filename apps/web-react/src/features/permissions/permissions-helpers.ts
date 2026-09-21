import type { RemoteSessionSummary, WorkspaceSummary } from '@aevra/admin-contracts';
import type { SearchOption } from '../../components/SearchableMultiSelect';
import { requestJson } from '../../services/api-client';

export interface PermissionRule extends Record<string, unknown> {
  id: string;
  effect?: string;
  capability?: string;
  scope?: string;
  actor?: string;
  matcher?: string;
  version?: number;
  status?: string;
  predicate_json?: string;
  workspaceId?: string;
  sessionId?: string;
  createdAt?: string;
  lastUsedAt?: string;
  expiresAt?: string;
}

export interface PermissionsPageData {
  rules: PermissionRule[];
  workspaces: WorkspaceSummary[];
  sessions: RemoteSessionSummary[];
}

export const CAPABILITIES = [
  'files.read',
  'files.search',
  'git.read',
  'skills.read',
  'instructions.read',
  'files.write',
  'files.delete',
  'commands.run',
  'git.commit',
  'git.push',
  'network',
  'skills.write',
  'instructions.write',
  'browser.control',
  'desktop.control',
  'mcp.proxy',
] as const;

export async function loadPermissionsData(signal: AbortSignal): Promise<PermissionsPageData> {
  const [rawRules, workspaces, sessions] = await Promise.all([
    requestJson<PermissionRule[]>('/api/permissions', { signal }),
    requestJson<WorkspaceSummary[]>('/api/workspaces', { signal }).catch(() => []),
    requestJson<RemoteSessionSummary[]>('/api/sessions', { signal }).catch(() => []),
  ]);
  const rules = rawRules.map((row: any) => ({
    ...row,
    workspaceId: row.workspaceId ?? row.workspace_id ?? undefined,
    sessionId: row.sessionId ?? row.session_id ?? undefined,
    createdAt: row.createdAt ?? row.created_at ?? undefined,
    lastUsedAt: row.lastUsedAt ?? row.last_used_at ?? undefined,
    expiresAt: row.expiresAt ?? row.expires_at ?? undefined,
    predicate_json: row.predicate_json ?? row.predicateJson,
  }));
  return { rules, workspaces, sessions };
}

export function buildWorkspaceOptions(workspaces: WorkspaceSummary[] = []): SearchOption[] {
  return workspaces.map((w) => ({
    value: w.id,
    label: w.name || w.id,
    description:
      w.name !== w.id
        ? `ID: ${w.id}${w.hostRoot ? ` · ${w.hostRoot}` : ''}`
        : (w.hostRoot ?? `ID: ${w.id}`),
  }));
}

export function buildSessionOptions(
  sessions: RemoteSessionSummary[] = [],
  workspaces: WorkspaceSummary[] = [],
): SearchOption[] {
  return sessions.map((s) => {
    const wsName = s.lease?.workspaceId
      ? workspaces.find((w) => w.id === s.lease?.workspaceId)?.name
      : undefined;
    const wsInfo = wsName
      ? `Workspace: ${wsName}`
      : s.lease?.workspaceId
        ? `Workspace: ${s.lease.workspaceId}`
        : '';
    return {
      value: s.id,
      label: s.actor ? `${s.actor} (${s.id})` : s.id,
      description: wsInfo ? `${wsInfo} · ID: ${s.id}` : `ID: ${s.id}`,
    };
  });
}
