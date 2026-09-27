import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import type { WorkspaceSummary } from '@aevra/admin-contracts';
import { DialogProvider } from '../../components/Dialog';
import { installApiFixtures } from '../../test/api-fixtures';
import { ConnectionDetailModal, type ActiveConnection } from './ConnectionDetailModal';

const workspaces: WorkspaceSummary[] = [{ id: 'ws-1', name: 'Aevra', hostRoot: '/repo' }];

const durable: ActiveConnection = {
  id: 'conn-9',
  connectionId: 'conn-9',
  authType: 'OAuth',
  workspaceIds: [],
};

function fixtures(options: Parameters<typeof installApiFixtures>[0] = {}) {
  return installApiFixtures({
    ...options,
    routes: {
      '/api/connections/conn-9/control': { connectionId: 'conn-9', browser: false, desktop: false },
      ...options.routes,
    },
  });
}

function called(fetchMock: ReturnType<typeof installApiFixtures>, path: string, method: string) {
  return fetchMock.mock.calls.some(
    ([input, init]) =>
      String(input) === path && String(init?.method ?? 'GET').toUpperCase() === method,
  );
}

function renderModal(connection: ActiveConnection, list: WorkspaceSummary[] = workspaces) {
  const onClose = vi.fn();
  const onChanged = vi.fn(async () => undefined);
  render(
    <DialogProvider>
      <ConnectionDetailModal
        connection={connection}
        workspaces={list}
        onClose={onClose}
        onChanged={onChanged}
      />
    </DialogProvider>,
  );
  return { onClose, onChanged };
}

test.each([
  ['CONNECTED', 'Connected'],
  ['GRACE', 'Reconnect grace'],
  ['OFFLINE', 'Offline / reconnectable'],
  ['REVOKED', 'Revoked'],
])('labels durable connection status %s', (status, label) => {
  fixtures();
  renderModal({ ...durable, status });
  expect(screen.getByText('Connection status').nextElementSibling).toHaveTextContent(label);
});

test('durable details fall back through provider, last-used and lifetime fields', () => {
  fixtures();
  renderModal({
    ...durable,
    yolo: true,
    lastActivityAt: 'not a date',
    accessTokenLifetimeSeconds: 3600,
    refreshFamilyExpiresAt: '2026-10-01T00:00:00.000Z',
    renewable: false,
    recentOrigins: [],
  });
  const dialog = screen.getByRole('dialog', { name: 'Connection' });
  expect(within(dialog).getAllByText('OAuth').length).toBe(2);
  expect(within(dialog).getByText('not a date')).toBeInTheDocument();
  expect(within(dialog).getByText('Enabled')).toBeInTheDocument();
  expect(within(dialog).getByText('60 min lifetime')).toBeInTheDocument();
  expect(within(dialog).getByText(/\(Expired\)$/)).toBeInTheDocument();
  expect(within(dialog).getByText('0')).toBeInTheDocument();
  expect(within(dialog).queryByText('Recent runner origins')).toBeNull();
  expect(within(dialog).queryByRole('button', { name: /YOLO/ })).toBeNull();
});

test('granted workspaces fall back to ids and the read-only profile', () => {
  fixtures();
  renderModal({ ...durable, workspaceIds: ['ws-gone'] });
  expect(screen.getByText('ws-gone')).toBeInTheDocument();
  expect(screen.getByLabelText('Profile for ws-gone')).toHaveTextContent('Read Only');
});

test('removing an unknown workspace names it by id', async () => {
  const user = userEvent.setup();
  const fetchMock = fixtures();
  renderModal({ ...durable, workspaceIds: ['ws-gone'] });
  await user.click(screen.getByRole('button', { name: 'Remove' }));
  const confirm = screen.getByRole('dialog', { name: 'Remove workspace grant' });
  expect(confirm).toHaveTextContent('Remove access to "ws-gone" for this connection?');
  await user.click(within(confirm).getByRole('button', { name: 'Remove' }));
  await waitFor(() =>
    expect(called(fetchMock, '/api/connections/conn-9/workspaces/ws-gone', 'DELETE')).toBe(true),
  );
});

test('revoking a durable connection without a client name uses its id', async () => {
  const user = userEvent.setup();
  const fetchMock = fixtures();
  const { onClose } = renderModal(durable);
  await user.click(screen.getByRole('button', { name: 'Revoke connection' }));
  const confirm = screen.getByRole('dialog', { name: 'Revoke connection' });
  expect(confirm).toHaveTextContent('Revoke conn-9 OAuth credentials and prevent silent resume?');
  await user.click(within(confirm).getByRole('button', { name: 'Revoke connection' }));
  await waitFor(() =>
    expect(called(fetchMock, '/api/connections/conn-9/revoke', 'POST')).toBe(true),
  );
  expect(onClose).toHaveBeenCalled();
});

test('revoking an unnamed session names it by session id', async () => {
  const user = userEvent.setup();
  fixtures();
  renderModal({ id: 'ses-7' });
  await user.click(screen.getByRole('button', { name: 'Revoke session' }));
  expect(screen.getByRole('dialog', { name: 'Revoke session' })).toHaveTextContent(
    'Disconnect ses-7?',
  );
});

test('durable connection with a live session asks to enable YOLO for the connection', async () => {
  const user = userEvent.setup();
  const fetchMock = fixtures();
  renderModal({ ...durable, sessionId: 'ses-live', yolo: false });
  await user.click(screen.getByRole('button', { name: 'Enable YOLO' }));
  const confirm = screen.getByRole('dialog', { name: 'Enable YOLO connection?' });
  await user.click(within(confirm).getByRole('button', { name: 'Enable YOLO' }));
  await waitFor(() => expect(called(fetchMock, '/api/sessions/ses-live/yolo', 'POST')).toBe(true));
});

test('non-Error mutation failures are shown as text', async () => {
  const user = userEvent.setup();
  fixtures();
  const onChanged = vi.fn(async () => {
    throw 'refresh unavailable';
  });
  render(
    <DialogProvider>
      <ConnectionDetailModal
        connection={{ id: 'ses-7', yolo: true }}
        workspaces={workspaces}
        onClose={vi.fn()}
        onChanged={onChanged}
      />
    </DialogProvider>,
  );
  await user.click(screen.getByRole('button', { name: 'Disable YOLO' }));
  expect(await screen.findByText('refresh unavailable')).toHaveClass('warning');
});

test('hides workspace granting when every workspace is already granted', () => {
  fixtures();
  renderModal({ id: 'ses-7', workspaceIds: ['ws-1'], workspaces: ['Aevra'] });
  expect(screen.queryByLabelText('Grant workspace')).toBeNull();
  expect(screen.getByText('Aevra')).toBeInTheDocument();
});
