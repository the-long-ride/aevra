import type { DashboardSectionId } from '@aevra/admin-contracts';

const normal: DashboardSectionId[] = [
  'runtime-overview',
  'active-connections',
  'tool-activity',
  'connections',
  'recent-activity',
];

export function dashboardOrder(completed: boolean): DashboardSectionId[] {
  return completed ? [...normal, 'onboarding'] : ['onboarding', ...normal];
}
