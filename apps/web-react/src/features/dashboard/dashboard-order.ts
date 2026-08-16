import type { DashboardSectionId } from '@aevra/admin-contracts';

const normal: DashboardSectionId[] = [
  'runtime-overview',
  'live-mcp-activity',
  'active-connections',
];

export function dashboardOrder(completed: boolean): DashboardSectionId[] {
  return completed ? [...normal, 'onboarding'] : ['onboarding', ...normal];
}
