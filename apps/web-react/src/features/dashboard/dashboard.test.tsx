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

test('incomplete Onboarding is first and open by default', async () => {
  const { container } = renderDashboard();
  const onboarding = await screen.findByText('Onboarding');
  const details = onboarding.closest('details');
  expect(details).not.toBeNull();
  expect(details?.open).toBe(true);
  const sections = container.querySelectorAll('[data-dashboard-section]');
  expect(sections[0]?.getAttribute('data-dashboard-section')).toBe('onboarding');
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

test('recent activity is merged into Runtime overview', async () => {
  const { container } = renderDashboard();
  const runtimeHeading = await screen.findByText('Runtime overview');
  const runtime = runtimeHeading.closest('details');
  expect(runtime).not.toBeNull();
  expect(within(runtime as HTMLElement).getByText('Remote sessions')).toBeInTheDocument();
  expect(within(runtime as HTMLElement).getByText('Pending requests')).toBeInTheDocument();
  expect(within(runtime as HTMLElement).getByText('Managed processes')).toBeInTheDocument();
  expect(within(runtime as HTMLElement).getByText('Open changes')).toBeInTheDocument();
  expect(container.querySelector('[data-dashboard-section="recent-activity"]')).toBeNull();
  expect(screen.queryByText('Recent activity')).not.toBeInTheDocument();
});

test('completed Onboarding is last and collapsed by default', async () => {
  installApiFixtures({ onboardingCompleted: true });
  const { container } = renderDashboard();
  await screen.findByText('Onboarding completed');
  const sections = container.querySelectorAll('[data-dashboard-section]');
  const onboarding = sections[sections.length - 1] as HTMLDetailsElement | undefined;
  expect(onboarding?.getAttribute('data-dashboard-section')).toBe('onboarding');
  expect(onboarding?.open).toBe(false);
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

test('Connections includes OAuth clients and distinguishes them from Bearer connectors', async () => {
  renderDashboard();
  await screen.findByRole('heading', { name: 'Dashboard' });
  await userEvent.setup().click(screen.getByRole('button', { name: /Connectors/i }));
  const section = screen.getByRole('dialog', { name: 'Connectors' });
  const table = within(section).getByRole('table');
  expect(within(table).getByRole('columnheader', { name: 'Auth' })).toBeInTheDocument();
  expect(within(table).getByText('ChatGPT')).toBeInTheDocument();
  expect(within(table).getByText('OAuth')).toBeInTheDocument();
  expect(within(table).getByText('Static client')).toBeInTheDocument();
  expect(within(table).getByText('Bearer connector')).toBeInTheDocument();
  expect(within(table).getAllByRole('button', { name: 'Revoke' })).toHaveLength(1);
});
test('connector creation presents the one-time token inside the React modal', async () => {
  const user = userEvent.setup();
  renderDashboard();
  await screen.findByRole('heading', { name: 'Dashboard' });

  await user.click(screen.getByRole('button', { name: /Connectors/i }));
  const connectors = screen.getByRole('dialog', { name: 'Connectors' });
  await user.click(within(connectors).getByRole('button', { name: 'New connector' }));
  const dialog = screen.getByRole('dialog', { name: 'Create Bearer connector' });
  await user.type(within(dialog).getByLabelText('Connector name'), 'Parity client');
  await user.click(within(dialog).getByRole('button', { name: 'Create token' }));

  expect(
    await within(dialog).findByText('Copy this token now. It is shown once.'),
  ).toBeInTheDocument();
  expect(within(dialog).getByText('secret-once')).toBeInTheDocument();
});

test('runtime overview opens process change tool and connector management modals', async () => {
  const user = userEvent.setup();
  installApiFixtures({
    routes: {
      '/api/processes': [
        {
          id: 'process-1',
          name: 'Vite dev server',
          workspace_id: 'ws-1',
          workspace_name: 'Aevra',
          ownership: 'owned',
          lifecycle: 'stop-with-aevra',
          state: 'running',
          created_at: '2026-08-21T00:00:00.000Z',
          command: { executable: 'npm', args: ['run', 'dev'], env: {} },
        },
      ],
      '/api/changes': [
        {
          id: 'change-1',
          name: 'Runtime UI',
          state: 'OPEN',
          workspace_id: 'ws-1',
          updated_at: '2026-08-21T01:00:00.000Z',
        },
      ],
    },
  });
  const { container } = renderDashboard();
  await screen.findByText('Runtime overview');

  for (const name of ['Managed processes', 'Open changes', 'Tool calls', 'Connectors']) {
    await user.click(screen.getByRole('button', { name: new RegExp(name, 'i') }));
    const dialog = await screen.findByRole('dialog', { name });
    expect(dialog).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
  }

  expect(container.querySelector('[data-dashboard-section="tool-activity"]')).toBeNull();
  expect(container.querySelector('[data-dashboard-section="connections"]')).toBeNull();
});
