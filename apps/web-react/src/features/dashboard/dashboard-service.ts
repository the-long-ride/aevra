import type {
  CloudflareStatus,
  DashboardRuntimeSnapshot,
  OnboardingStatus,
  WorkspaceSummary,
} from '@aevra/admin-contracts';
import { requestJson } from '../../services/api-client';

export interface DashboardData {
  snapshot: DashboardRuntimeSnapshot;
  onboarding: OnboardingStatus;
  cloudflare: CloudflareStatus;
  workspaces: WorkspaceSummary[];
}

export async function loadDashboard(signal?: AbortSignal): Promise<DashboardData> {
  const options = signal ? { signal } : {};
  const [snapshot, onboarding, cloudflare, workspaces] = await Promise.all([
    requestJson<DashboardRuntimeSnapshot>('/api/dashboard/runtime', options),
    requestJson<OnboardingStatus>('/api/onboarding', options),
    requestJson<CloudflareStatus>('/api/cloudflare/status', options),
    requestJson<WorkspaceSummary[]>('/api/workspaces', options),
  ]);
  return { snapshot, onboarding, cloudflare, workspaces };
}

export async function completeOnboarding(): Promise<void> {
  await requestJson('/api/onboarding', {
    method: 'PATCH',
    body: JSON.stringify({
      completed: true,
      completedSections: [
        'remote-access',
        'connect-ai',
        'workspace',
        'try-aevra',
        'explore',
      ],
    }),
  });
}

export async function registerWorkspace(data: FormData): Promise<void> {
  await requestJson('/api/workspaces', {
    method: 'POST',
    body: JSON.stringify(Object.fromEntries(data)),
  });
}
