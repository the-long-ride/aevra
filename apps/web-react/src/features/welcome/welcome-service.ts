import type { OnboardingStatus, TunnelToolsStatus } from '@aevra/admin-contracts';
import { requestJson } from '../../services/api-client';

/**
 * The welcome modal reuses the server-side onboarding flag, so a user who finished
 * the old Dashboard onboarding is treated as having already seen the welcome.
 */
export async function loadWelcomeSeen(): Promise<boolean> {
  const status = await requestJson<OnboardingStatus>('/api/onboarding');
  return status?.completed === true;
}

export async function markWelcomeSeen(): Promise<void> {
  await requestJson('/api/onboarding', {
    method: 'PATCH',
    body: JSON.stringify({ completed: true, completedSections: ['welcome'] }),
  });
}

export async function loadTunnelTools(): Promise<TunnelToolsStatus> {
  return requestJson<TunnelToolsStatus>('/api/system/tunnel-tools');
}
