import { expect, test } from 'vitest';
import { dashboardOrder } from './dashboard-order';

test('dashboard sections run from runtime overview to system capabilities', () => {
  expect(dashboardOrder()).toEqual([
    'runtime-overview',
    'live-mcp-activity',
    'active-connections',
    'system-capabilities',
  ]);
});
