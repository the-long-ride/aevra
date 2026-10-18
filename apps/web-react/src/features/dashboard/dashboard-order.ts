import type { DashboardSectionId } from '@aevra/admin-contracts';

const order: DashboardSectionId[] = [
  'runtime-overview',
  'live-mcp-activity',
  'active-connections',
  'system-capabilities',
];

export function dashboardOrder(): DashboardSectionId[] {
  return [...order];
}
