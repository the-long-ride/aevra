import type {
  DashboardRuntimeSnapshot,
  ExposureStatus,
  OnboardingStatus,
  WorkspaceSummary,
} from '@aevra/admin-contracts';
import { requestJson } from '../../services/api-client';

export interface DashboardData {
  snapshot: DashboardRuntimeSnapshot;
  onboarding: OnboardingStatus;
  exposure: ExposureStatus;
  workspaces: WorkspaceSummary[];
}

export async function loadDashboard(signal?: AbortSignal): Promise<DashboardData> {
  const options = signal ? { signal } : {};
  const [snapshot, onboarding, exposure, workspaces] = await Promise.all([
    requestJson<DashboardRuntimeSnapshot>('/api/dashboard/runtime', options),
    requestJson<OnboardingStatus>('/api/onboarding', options),
    requestJson<ExposureStatus>('/api/exposure/status', options),
    requestJson<WorkspaceSummary[]>('/api/workspaces', options),
  ]);
  return { snapshot, onboarding, exposure, workspaces };
}

export async function completeOnboarding(): Promise<void> {
  await requestJson('/api/onboarding', {
    method: 'PATCH',
    body: JSON.stringify({
      completed: true,
      completedSections: ['remote-access', 'connect-ai', 'workspace', 'try-aevra', 'explore'],
    }),
  });
}

export async function registerWorkspace(data: FormData): Promise<void> {
  await requestJson('/api/workspaces', {
    method: 'POST',
    body: JSON.stringify(Object.fromEntries(data)),
  });
}

export async function revokeActiveConnection(connection: Record<string, unknown>): Promise<void> {
  const connectionId = typeof connection.connectionId === 'string' ? connection.connectionId : '';
  const sessionId =
    typeof connection.sessionId === 'string'
      ? connection.sessionId
      : typeof connection.id === 'string'
        ? connection.id
        : '';
  if (connectionId) {
    try {
      await requestJson(`/api/connections/${encodeURIComponent(connectionId)}/revoke`, {
        method: 'POST',
        body: '{}',
      });
      return;
    } catch (error: any) {
      if (sessionId && (error?.status === 404 || error?.statusCode === 404)) {
        await requestJson(`/api/sessions/${encodeURIComponent(sessionId)}/revoke`, {
          method: 'POST',
          body: '{}',
        });
        return;
      }
      throw error;
    }
  }
  if (!sessionId) throw new Error('Connection has no revocable session identifier.');
  await requestJson(`/api/sessions/${encodeURIComponent(sessionId)}/revoke`, {
    method: 'POST',
    body: '{}',
  });
}
