import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test } from 'vitest';
import { DialogProvider } from '../../components/Dialog';
import { installApiFixtures } from '../../test/api-fixtures';
import { DashboardPage } from './DashboardPage';

beforeEach(() => {
  installApiFixtures();
});

function renderDashboard() {
  return render(
    <DialogProvider>
      <DashboardPage />
    </DialogProvider>,
  );
}

test('Remote Access is first inside incomplete Onboarding', async () => {
  renderDashboard();
  const onboarding = await screen.findByText('Onboarding');
  const details = onboarding.closest('details');
  expect(details).not.toBeNull();
  const blocks = details?.querySelectorAll('[data-onboarding-section]');
  expect(blocks?.[0]?.getAttribute('data-onboarding-section')).toBe('remote-access');
  expect(within(details as HTMLElement).getByText('Connect an AI')).toBeInTheDocument();
});

test('live MCP activity follows Runtime overview', async () => {
  const { container } = renderDashboard();
  await screen.findByText('Runtime overview');
  const ids = [...container.querySelectorAll('[data-dashboard-section]')].map((section) =>
    section.getAttribute('data-dashboard-section'),
  );
  expect(ids.indexOf('live-mcp-activity')).toBe(ids.indexOf('runtime-overview') + 1);
});

test('completed Onboarding is the final Dashboard section', async () => {
  installApiFixtures({ onboardingCompleted: true });
  const { container } = renderDashboard();
  await screen.findByText('Onboarding completed');
  const sections = container.querySelectorAll('[data-dashboard-section]');
  expect(sections[sections.length - 1]?.getAttribute('data-dashboard-section')).toBe('onboarding');
});

test('collapsed Dashboard section remains collapsed after data refresh', async () => {
  const user = userEvent.setup();
  renderDashboard();
  const summary = await screen.findByText('Runtime overview');
  const details = summary.closest('details');
  expect(details?.open).toBe(true);
  await user.click(summary);
  expect(details?.open).toBe(false);
  await new Promise((resolve) => window.setTimeout(resolve, 2100));
  expect(details?.open).toBe(false);
});

test('connector creation presents the one-time token inside the React modal', async () => {
  const user = userEvent.setup();
  renderDashboard();
  await screen.findByRole('heading', { name: 'Dashboard' });

  await user.click(screen.getByRole('button', { name: 'New connector' }));
  const dialog = screen.getByRole('dialog', { name: 'Create Bearer connector' });
  await user.type(within(dialog).getByLabelText('Connector name'), 'Parity client');
  await user.click(within(dialog).getByRole('button', { name: 'Create token' }));

  expect(
    await within(dialog).findByText('Copy this token now. It is shown once.'),
  ).toBeInTheDocument();
  expect(within(dialog).getByText('secret-once')).toBeInTheDocument();
});
