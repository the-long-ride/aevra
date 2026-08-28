import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { DialogProvider } from '../../components/Dialog';
import { installApiFixtures } from '../../test/api-fixtures';
import { DashboardPage } from './DashboardPage';

test('Runtime overview shows operational metrics without duplicating Version', async () => {
  installApiFixtures();
  render(
    <DialogProvider>
      <DashboardPage />
    </DialogProvider>,
  );

  expect(await screen.findByText('Remote sessions')).toBeInTheDocument();
  expect(screen.getByText('Workspace leases')).toBeInTheDocument();
  expect(screen.getByText('Pending requests')).toBeInTheDocument();
  expect(screen.queryByText('Version')).not.toBeInTheDocument();
});

test('Runtime overview opens transport validation details', async () => {
  installApiFixtures();
  render(
    <DialogProvider>
      <DashboardPage />
    </DialogProvider>,
  );
  const user = userEvent.setup();

  await user.click(await screen.findByRole('button', { name: /Transport/ }));

  const dialog = await screen.findByRole('dialog', { name: 'Transport validation' });
  expect(within(dialog).getByText('https://127.0.0.1:47830')).toBeInTheDocument();
  expect(within(dialog).getByText('https://localhost:47831')).toBeInTheDocument();
  expect(within(dialog).getByText('https://localhost:47832')).toBeInTheDocument();
});

test('Active connections marks YOLO sessions and explains immutable approvals', async () => {
  installApiFixtures({
    routes: {
      '/api/dashboard/runtime': {
        status: { version: '0.1.0' },
        uptimeSeconds: 100,
        pending: { total: 0 },
        stats: {
          sessions: 1,
          workspaceLeases: 1,
          processes: 0,
          openChanges: 0,
          toolCalls: 3,
          avgToolLatencyMs: 10,
          connectors: 1,
        },
        metrics: [],
        activeConnections: [
          {
            client: 'ChatGPT',
            authType: 'OAuth',
            workspace: 'Aevra',
            status: 'active',
            capabilities: ['files.read'],
            yolo: true,
            lastActivityAt: '2026-08-19T00:00:00Z',
          },
        ],
        connectors: [],
      },
    },
  });
  render(
    <DialogProvider>
      <DashboardPage />
    </DialogProvider>,
  );

  expect(await screen.findByText('YOLO')).toBeInTheDocument();
  expect(
    screen.getByText(/YOLO enabled.*immutable security approvals still require confirmation/),
  ).toBeInTheDocument();
});

test('Runtime overview shows sleep inhibition reason with a status dot', async () => {
  installApiFixtures({
    routes: {
      '/api/dashboard/runtime': {
        status: { version: '0.1.0' },
        uptimeSeconds: 100,
        pending: { total: 0 },
        stats: {
          sessions: 1,
          workspaceLeases: 1,
          processes: 0,
          openChanges: 0,
          toolCalls: 0,
          avgToolLatencyMs: null,
          connectors: 0,
        },
        power: {
          mode: 'remote-connections',
          active: true,
          supported: true,
          platform: 'win32',
          reason: '1 remote connection',
          remoteConnections: 1,
          managedProcesses: 0,
        },
        metrics: [],
        activeConnections: [],
        connectors: [],
      },
    },
  });
  render(
    <DialogProvider>
      <DashboardPage />
    </DialogProvider>,
  );

  const sleepLabel = await screen.findByText('Sleep inhibition');
  const sleepStat = sleepLabel.closest('.runtime-stat');
  expect(sleepStat).toHaveClass('runtime-stat-compact');
  expect(within(sleepStat as HTMLElement).getByText('1 remote connection')).toHaveClass(
    'runtime-stat-detail',
  );
  expect(within(sleepStat as HTMLElement).getByLabelText('Enabled')).toHaveClass('active');
  expect(within(sleepStat as HTMLElement).queryByText('Active')).not.toBeInTheDocument();
});

test('Pending requests opens the request drawer trigger', async () => {
  installApiFixtures();
  const requestButton = document.createElement('button');
  requestButton.id = 'open-requests';
  let opened = false;
  requestButton.addEventListener('click', () => {
    opened = true;
  });
  document.body.append(requestButton);

  render(
    <DialogProvider>
      <DashboardPage />
    </DialogProvider>,
  );

  await userEvent.setup().click(await screen.findByRole('button', { name: /Pending requests/ }));
  expect(opened).toBe(true);
  requestButton.remove();
});

test('Active connections can select all and unselect all rows', async () => {
  installApiFixtures({
    routes: {
      '/api/dashboard/runtime': {
        status: { version: '0.1.0' },
        uptimeSeconds: 1,
        pending: { total: 0 },
        metrics: [],
        stats: {
          sessions: 2,
          workspaceLeases: 0,
          processes: 0,
          openChanges: 0,
          toolCalls: 0,
          avgToolLatencyMs: null,
          connectors: 0,
        },
        activeConnections: [
          {
            id: 'c1',
            client: 'Client 1',
            authType: 'OAuth',
            status: 'CONNECTED',
            capabilities: [],
          },
          {
            id: 'c2',
            client: 'Client 2',
            authType: 'OAuth',
            status: 'CONNECTED',
            capabilities: [],
          },
        ],
        connectors: [],
      },
    },
  });
  render(
    <DialogProvider>
      <DashboardPage />
    </DialogProvider>,
  );
  const user = userEvent.setup();

  const selectAllBtn = await screen.findByRole('button', { name: 'Select all' });
  const unselectAllBtn = screen.getByRole('button', { name: 'Unselect all' });

  expect(selectAllBtn).toBeEnabled();
  expect(unselectAllBtn).toBeDisabled();

  await user.click(selectAllBtn);
  expect(screen.getByText('2 selected')).toBeInTheDocument();
  expect(screen.getByRole('switch', { name: 'Select Client 1' })).toBeChecked();
  expect(screen.getByRole('switch', { name: 'Select Client 2' })).toBeChecked();
  expect(selectAllBtn).toBeDisabled();
  expect(unselectAllBtn).toBeEnabled();

  await user.click(unselectAllBtn);
  expect(screen.getByText('Select one or more connections to revoke')).toBeInTheDocument();
  expect(screen.getByRole('switch', { name: 'Select Client 1' })).not.toBeChecked();
  expect(screen.getByRole('switch', { name: 'Select Client 2' })).not.toBeChecked();
  expect(selectAllBtn).toBeEnabled();
  expect(unselectAllBtn).toBeDisabled();
});

test('Active connections can revoke selected rows', async () => {
  const fetchMock = installApiFixtures();
  render(
    <DialogProvider>
      <DashboardPage />
    </DialogProvider>,
  );
  const user = userEvent.setup();

  await user.click(await screen.findByRole('switch', { name: 'Select ChatGPT' }));
  expect(screen.getByText('1 selected')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Revoke selected' }));

  const dialog = await screen.findByRole('dialog');
  await user.click(within(dialog).getByRole('button', { name: 'Revoke selected' }));

  await waitFor(() =>
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) => input === '/api/sessions/ses-chatgpt/revoke' && init?.method === 'POST',
      ),
    ).toBe(true),
  );
});

test('bulk revoke refreshes after partial failure and keeps failed selection', async () => {
  const fetchMock = installApiFixtures({
    routes: {
      '/api/dashboard/runtime': {
        status: { version: '0.1.0' },
        uptimeSeconds: 1,
        pending: { total: 0 },
        metrics: [],
        stats: {
          sessions: 2,
          workspaceLeases: 0,
          processes: 0,
          openChanges: 0,
          toolCalls: 0,
          avgToolLatencyMs: null,
          connectors: 0,
        },
        activeConnections: [
          { id: 'ok', client: 'OK', authType: 'OAuth', status: 'CONNECTED', capabilities: [] },
          { id: 'bad', client: 'Bad', authType: 'OAuth', status: 'CONNECTED', capabilities: [] },
        ],
        connectors: [],
      },
    },
    mutationResponses: { 'POST /api/sessions/bad/revoke': new Response('no', { status: 500 }) },
  });
  render(
    <DialogProvider>
      <DashboardPage />
    </DialogProvider>,
  );
  const user = userEvent.setup();
  await user.click(await screen.findByRole('switch', { name: 'Select OK' }));
  await user.click(screen.getByRole('switch', { name: 'Select Bad' }));
  await user.click(screen.getByRole('button', { name: 'Revoke selected' }));
  await user.click(
    within(await screen.findByRole('dialog')).getByRole('button', { name: 'Revoke selected' }),
  );
  expect(await screen.findByText('1 connection revoked; 1 failed.')).toBeInTheDocument();
  expect(screen.getByRole('switch', { name: 'Select Bad' })).toBeChecked();
  expect(screen.getByRole('switch', { name: 'Select OK' })).not.toBeChecked();
  expect(
    fetchMock.mock.calls.filter(([url]) => url === '/api/dashboard/runtime').length,
  ).toBeGreaterThan(1);
});
