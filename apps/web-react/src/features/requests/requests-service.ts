import type {
  ApprovalItem,
  ApprovalScope,
  OauthRequestItem,
  WorkspaceSummary,
} from '@aevra/admin-contracts';
import { requestJson } from '../../services/api-client';

export interface RequestsData {
  approvals: ApprovalItem[];
  oauth: OauthRequestItem[];
  workspaces: WorkspaceSummary[];
}

export async function loadRequests(): Promise<RequestsData> {
  const [approvals, oauth, workspaces] = await Promise.all([
    requestJson<ApprovalItem[]>('/api/approvals'),
    requestJson<OauthRequestItem[]>('/api/oauth/requests'),
    requestJson<WorkspaceSummary[]>('/api/workspaces'),
  ]);
  return { approvals, oauth, workspaces };
}

export async function approveRequest(id: string, scope: ApprovalScope) {
  await requestJson(`/api/approvals/${encodeURIComponent(id)}/approve`, {
    method: 'POST',
    body: JSON.stringify({ scope }),
  });
}

export async function denyRequest(id: string) {
  await requestJson(`/api/approvals/${encodeURIComponent(id)}/deny`, {
    method: 'POST',
    body: '{}',
  });
}

export async function decideOauth(id: string, allow: boolean) {
  await requestJson(
    `/api/oauth/requests/${encodeURIComponent(id)}/${allow ? 'approve' : 'deny'}`,
    { method: 'POST', body: '{}' },
  );
}
