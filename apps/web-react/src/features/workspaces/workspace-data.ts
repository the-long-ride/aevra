import type { WorkspaceSummary } from '@aevra/admin-contracts';
import { useState } from 'react';
import { useApiResource } from '../../hooks/use-api-resource';
import { requestJson } from '../../services/api-client';

interface WorkspaceMount extends Record<string, unknown> {
  id: string;
  logicalPath?: string;
  hostRoot?: string;
  capabilities?: string[];
  sensitivityPolicyId?: string;
}

export interface WorkspaceRow extends WorkspaceSummary, Record<string, unknown> {
  mounts: WorkspaceMount[];
  mountCount: number;
  mountState: string;
}

async function load(signal: AbortSignal): Promise<WorkspaceRow[]> {
  const workspaces = await requestJson<WorkspaceSummary[]>('/api/workspaces', {
    signal,
  });
  return Promise.all(
    workspaces.map(async (workspace) => {
      const mounts = await requestJson<WorkspaceMount[]>(
        `/api/workspaces/${encodeURIComponent(workspace.id)}/mounts`,
        { signal },
      );
      return {
        ...workspace,
        mounts,
        mountCount: mounts.length,
        mountState: mounts.length ? 'Has mounts' : 'No mounts',
      };
    }),
  );
}

export function useWorkspaceRows() {
  return useApiResource(load);
}

export function useCopiedWorkspaceId() {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copyWorkspaceId = async (id: string) => {
    await navigator.clipboard.writeText(id);
    setCopiedId(id);
    window.setTimeout(() => {
      setCopiedId((current) => (current === id ? null : current));
    }, 1600);
  };
  return { copiedId, copyWorkspaceId };
}
