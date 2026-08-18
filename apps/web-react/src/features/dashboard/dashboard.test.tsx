import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test } from 'vitest';
import { installApiFixtures } from '../../test/api-fixtures';
import { DashboardPage } from './DashboardPage';

beforeEach(() => {
  installApiFixtures();
});

test('Remote Access is first inside incomplete Onboarding', async () => {
  render(<DashboardPage />);
  const onboarding = await screen.findByText('Onboarding');
  const details = onboarding.closest('details');
  expect(details).not.toBeNull();
  const blocks = details?.querySelectorAll('[data-onboarding-section]');
  expect(blocks?.[0]?.getAttribute('data-onboarding-section')).toBe('remote-access');
  expect(within(details as HTMLElement).getByText('Connect an AI')).toBeInTheDocument();
});

test('completed Onboarding is the final Dashboard section', async () => {
  installApiFixtures({ onboardingCompleted: true });
  const { container } = render(<DashboardPage />);
  await screen.findByText('Onboarding completed');
  const sections = container.querySelectorAll('[data-dashboard-section]');
  expect(sections[sections.length - 1]?.getAttribute('data-dashboard-section')).toBe(
    'onboarding',
  );
});

test('collapsed Dashboard section remains collapsed after data refresh', async () => {
  const user = userEvent.setup();
  render(<DashboardPage />);
  const summary = await screen.findByText('Runtime overview');
  const details = summary.closest('details');
  expect(details?.open).toBe(true);
  await user.click(summary);
  expect(details?.open).toBe(false);
  await new Promise((resolve) => window.setTimeout(resolve, 2100));
  expect(details?.open).toBe(false);
});
