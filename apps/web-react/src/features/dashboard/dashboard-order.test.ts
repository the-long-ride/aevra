import { expect, test } from 'vitest';
import { dashboardOrder } from './dashboard-order';

test('system capabilities stays final after onboarding completes', () => {
  expect(dashboardOrder(true).at(-1)).toBe('system-capabilities');
});
