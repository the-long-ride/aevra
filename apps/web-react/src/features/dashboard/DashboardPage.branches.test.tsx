import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { DialogProvider } from '../../components/Dialog';
import { installApiFixtures } from '../../test/api-fixtures';
import { DashboardPage } from './DashboardPage';

const connections = [
  {
    id: 'conn-a',
    connectionId: 'conn-a',
    client: 'Alpha',
    authType: 'OAuth',
    capabilities: 'files.read',
  },
  { sessionId: 'ses-b', client: 'Beta', authType: 'Session', yolo: true },
  { connectionId: 'conn-c', authType: 'Bearer' },
  { sessionId: 'ses-d', authType: 'Device' },
  { authType: 'Unknown' },
];

function runtime(activeConnections: unknown[] = connections) {
  return {
    status: { version: '0.1.0' },
    uptimeSeconds: 100,
    pending: { total: 0 },
    stats: { sessions: 1, workspaceLeases: 0, processes: 0, openChanges: 0, toolCalls: 0 },
    metrics: [],
    activeConnections,
    connectors: [],
  };
}

function failure(message: string) {
  return new Response(JSON.stringify({ error: { code: 'FAILED', message } }), {
    status: 500,
    headers: { 'content-type': 'application/json' },
  });
}

function posted(fetchMock: ReturnType<typeof installApiFixtures>, path: string) {
  return fetchMock.mock.calls.some(
    ([input, init]) => String(input) === path && String(init?.method).toUpperCase() === 'POST',
  );
}

function renderPage(options: Parameters<typeof installApiFixtures>[0] = {}) {
  const fetchMock = installApiFixtures({
    ...options,
    routes: {
      '/api/dashboard/runtime': runtime(),
      '/api/connections/conn-a/control': { connectionId: 'conn-a', browser: false, desktop: false },
      ...options.routes,
    },
  });
  render(
    <DialogProvider>
      <DashboardPage />
    </DialogProvider>,
  );
  return fetchMock;
}

function rowFor(text: string) {
  return screen
    .getAllByText(text)
    .map((node) => node.closest('tr'))
    .find(Boolean) as HTMLElement;
}

test('selection switches use session ids and skip rows without any id', async () => {
  renderPage();
  expect(await screen.findByText('Beta')).toBeInTheDocument();
  expect(screen.getByRole('switch', { name: 'Select ses-d' })).toBeInTheDocument();
  expect(within(rowFor('Bearer')).queryByRole('switch')).toBeNull();
  expect(screen.getAllByRole('switch', { name: /^Select / })).toHaveLength(3);

  const beta = screen.getByRole('switch', { name: 'Select Beta' });
  fireEvent.click(beta);
  expect(screen.getByText('1 selected')).toBeInTheDocument();
  fireEvent.click(beta);
  expect(screen.getByText('Select one or more connections to revoke')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Unselect all' })).toBeDisabled();
});

test('the YOLO banner and capability fallbacks render from the rows', async () => {
  renderPage();
  expect(await screen.findByText('Alpha')).toBeInTheDocument();
  expect(screen.getByText(/^YOLO enabled/)).toBeInTheDocument();
  expect(within(rowFor('Alpha')).queryByRole('button', { name: 'files.read' })).toBeNull();
  const table = document.querySelector('[data-table-id="react-dashboard-active"]') as HTMLElement;
  const search = within(table).getByRole('searchbox');
  fireEvent.change(search, { target: { value: 'files.read' } });
  expect(screen.getByText('Alpha')).toBeInTheDocument();
  expect(screen.queryByText('Beta')).toBeNull();
  fireEvent.change(search, { target: { value: 'YOLO' } });
  expect(screen.getByText('Beta')).toBeInTheDocument();
  expect(screen.queryByText('Alpha')).toBeNull();
});

test('cancelling a batch revocation sends nothing', async () => {
  const user = userEvent.setup();
  const fetchMock = renderPage();
  await user.click(await screen.findByRole('button', { name: 'Select all' }));
  expect(screen.getByText('3 selected')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Select all' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Revoke selected' }));
  const confirm = await screen.findByRole('dialog', { name: 'Revoke selected connections' });
  await user.click(within(confirm).getByRole('button', { name: 'Cancel' }));
  expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  expect(screen.getByText('3 selected')).toBeInTheDocument();
});

test('a partial batch failure keeps the failed row selected and reports counts', async () => {
  const user = userEvent.setup();
  const fetchMock = renderPage({
    mutationResponses: { 'POST /api/connections/conn-a/revoke': failure('refused') },
  });
  fireEvent.click(await screen.findByRole('switch', { name: 'Select Alpha' }));
  fireEvent.click(screen.getByRole('switch', { name: 'Select Beta' }));
  await user.click(screen.getByRole('button', { name: 'Revoke selected' }));
  const confirm = await screen.findByRole('dialog', { name: 'Revoke selected connections' });
  expect(confirm).toHaveTextContent('Revoke 2 selected connections?');
  await user.click(within(confirm).getByRole('button', { name: 'Revoke selected' }));
  const report = await screen.findByRole('dialog', { name: 'Connection revocation' });
  expect(report).toHaveTextContent('1 connection revoked; 1 failed.');
  expect(posted(fetchMock, '/api/sessions/ses-b/revoke')).toBe(true);
  expect(screen.getByText('1 selected')).toBeInTheDocument();
});

test('a fully failed batch reports zero revoked connections', async () => {
  const user = userEvent.setup();
  renderPage({
    mutationResponses: {
      'POST /api/connections/conn-a/revoke': failure('refused'),
      'POST /api/sessions/ses-b/revoke': failure('refused'),
    },
  });
  fireEvent.click(await screen.findByRole('switch', { name: 'Select Alpha' }));
  fireEvent.click(screen.getByRole('switch', { name: 'Select Beta' }));
  await user.click(screen.getByRole('button', { name: 'Revoke selected' }));
  const confirm = await screen.findByRole('dialog', { name: 'Revoke selected connections' });
  await user.click(within(confirm).getByRole('button', { name: 'Revoke selected' }));
  expect(await screen.findByRole('dialog', { name: 'Connection revocation' })).toHaveTextContent(
    '0 connections revoked; 2 failed.',
  );
});

test('batch revoking the connection open in details closes the details', async () => {
  const user = userEvent.setup();
  renderPage();
  await screen.findByText('Alpha');
  await user.click(within(rowFor('Alpha')).getByRole('button', { name: 'Details' }));
  expect(await screen.findByRole('dialog', { name: 'Alpha' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('switch', { name: 'Select Alpha' }));
  await user.click(screen.getByRole('button', { name: 'Revoke selected' }));
  const confirm = await screen.findByRole('dialog', { name: 'Revoke selected connections' });
  expect(confirm).toHaveTextContent('Revoke 1 selected connection?');
  await user.click(within(confirm).getByRole('button', { name: 'Revoke selected' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Alpha' })).toBeNull());
});

test('single revoke names unnamed rows by connection id and closes open details', async () => {
  const user = userEvent.setup();
  const fetchMock = renderPage();
  await screen.findByText('Bearer');
  await user.click(within(rowFor('Bearer')).getByRole('button', { name: 'Revoke' }));
  let confirm = await screen.findByRole('dialog', { name: 'Revoke connection' });
  expect(confirm).toHaveTextContent('Revoke conn-c?');
  await user.click(within(confirm).getByRole('button', { name: 'Revoke' }));
  await waitFor(() => expect(posted(fetchMock, '/api/connections/conn-c/revoke')).toBe(true));

  await user.click(within(rowFor('Alpha')).getByRole('button', { name: 'Details' }));
  expect(await screen.findByRole('dialog', { name: 'Alpha' })).toBeInTheDocument();
  await user.click(within(rowFor('Alpha')).getByRole('button', { name: 'Revoke' }));
  confirm = await screen.findByRole('dialog', { name: 'Revoke connection' });
  await user.click(within(confirm).getByRole('button', { name: 'Revoke' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Alpha' })).toBeNull());
});

test('single revoke names session-only rows and reports identifier errors', async () => {
  const user = userEvent.setup();
  renderPage();
  await screen.findByText('Device');
  await user.click(within(rowFor('Device')).getByRole('button', { name: 'Revoke' }));
  const confirm = await screen.findByRole('dialog', { name: 'Revoke connection' });
  expect(confirm).toHaveTextContent('Revoke ses-d?');
  await user.click(within(confirm).getByRole('button', { name: 'Cancel' }));

  await user.click(within(rowFor('Unknown')).getByRole('button', { name: 'Revoke' }));
  const nameless = await screen.findByRole('dialog', { name: 'Revoke connection' });
  expect(nameless).toHaveTextContent('Revoke connection?');
  await user.click(within(nameless).getByRole('button', { name: 'Revoke' }));
  expect(await screen.findByRole('dialog', { name: 'Revocation failed' })).toHaveTextContent(
    'Connection has no revocable session identifier.',
  );
});
