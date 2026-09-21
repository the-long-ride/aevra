import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { DialogProvider } from '../../components/Dialog';
import { installApiFixtures } from '../../test/api-fixtures';
import { DashboardPage } from './DashboardPage';

const runtimeData = {
  status: { version: '0.1.0' },
  uptimeSeconds: 100,
  pending: { total: 0 },
  stats: {
    sessions: 2,
    workspaceLeases: 2,
    processes: 0,
    openChanges: 0,
    toolCalls: 5,
    avgToolLatencyMs: 10,
    connectors: 2,
  },
  metrics: [],
  activeConnections: [
    {
      id: 'conn-1',
      connectionId: 'conn-1',
      client: 'ChatGPT',
      authType: 'OAuth',
      workspace: 'Aevra',
      workspaceId: 'ws-aevra',
      sessionId: 'ses-1',
      startedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    },
    {
      id: 'conn-2',
      connectionId: 'conn-2',
      client: 'Claude',
      authType: 'OAuth',
      workspace: 'Quotashift',
      workspaceId: 'ws-quota',
      sessionId: 'ses-2',
      startedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    },
  ],
};

test('DashboardPage: revokes a single active connection with confirmation and cancel', async () => {
  const user = userEvent.setup();
  const fetchMock = installApiFixtures({
    routes: {
      '/api/dashboard/runtime': runtimeData,
      '/api/connections/conn-1/revoke': { ok: true },
    },
  });

  render(
    <DialogProvider>
      <DashboardPage />
    </DialogProvider>,
  );

  expect(await screen.findByText('ChatGPT')).toBeInTheDocument();

  const [firstRevoke] = await screen.findAllByRole('button', { name: 'Revoke' });
  await user.click(firstRevoke);

  const confirmDialog = await screen.findByRole('dialog', { name: 'Revoke connection' });
  expect(within(confirmDialog).getByText(/Revoke ChatGPT\?/)).toBeInTheDocument();

  const confirmBtn = within(confirmDialog).getByRole('button', { name: 'Revoke' });
  fireEvent.click(confirmBtn);

  await waitFor(() => {
    const postCalls = fetchMock.mock.calls.filter(([u, i]) => i?.method === 'POST');
    expect(postCalls.some(([url]) => String(url).includes('/api/connections/conn-1/revoke'))).toBe(
      true,
    );
  });
});

test('DashboardPage: cancels connection revocation when Cancel is clicked', async () => {
  const user = userEvent.setup();
  const fetchMock = installApiFixtures({
    routes: {
      '/api/dashboard/runtime': runtimeData,
    },
  });

  render(
    <DialogProvider>
      <DashboardPage />
    </DialogProvider>,
  );

  expect(await screen.findByText('ChatGPT')).toBeInTheDocument();

  const [firstRevoke] = await screen.findAllByRole('button', { name: 'Revoke' });
  await user.click(firstRevoke);

  const confirmDialog = await screen.findByRole('dialog', { name: 'Revoke connection' });
  const cancelBtn = within(confirmDialog).getByRole('button', { name: 'Cancel' });
  fireEvent.click(cancelBtn);

  expect(
    fetchMock.mock.calls.some(
      ([url, init]) => String(url).includes('/revoke') && init?.method === 'POST',
    ),
  ).toBe(false);
});

test('DashboardPage: revokes selected connections in batch', async () => {
  const user = userEvent.setup();
  const fetchMock = installApiFixtures({
    routes: {
      '/api/dashboard/runtime': runtimeData,
      '/api/connections/conn-1/revoke': { ok: true },
      '/api/connections/conn-2/revoke': { ok: true },
    },
  });

  render(
    <DialogProvider>
      <DashboardPage />
    </DialogProvider>,
  );

  expect(await screen.findByText('ChatGPT')).toBeInTheDocument();

  // Click select all
  const selectAllBtn = screen.getByRole('button', { name: 'Select all' });
  await user.click(selectAllBtn);

  expect(screen.getByText('2 selected')).toBeInTheDocument();

  const revokeSelectedBtn = screen.getByRole('button', { name: 'Revoke selected' });
  await user.click(revokeSelectedBtn);

  const confirmDialog = await screen.findByRole('dialog', {
    name: 'Revoke selected connections',
  });
  expect(within(confirmDialog).getByText(/Revoke 2 selected connections\?/)).toBeInTheDocument();
  fireEvent.click(within(confirmDialog).getByRole('button', { name: 'Revoke selected' }));

  await waitFor(() => {
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes('/api/connections/conn-1/revoke')),
    ).toBe(true);
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes('/api/connections/conn-2/revoke')),
    ).toBe(true);
  });
});
