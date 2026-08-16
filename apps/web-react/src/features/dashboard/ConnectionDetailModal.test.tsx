import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import type { WorkspaceSummary } from '@aevra/admin-contracts';
import { DialogProvider } from '../../components/Dialog';
import { installApiFixtures } from '../../test/api-fixtures';
import { ConnectionDetailModal, type ActiveConnection } from './ConnectionDetailModal';

const workspaces: WorkspaceSummary[] = [
  { id: 'ws-1', name: 'Aevra', hostRoot: '/repo' },
  { id: 'ws-2', name: 'Docs', hostRoot: '/docs' },
];

const connection: ActiveConnection = {
  id: 'ses-chatgpt',
  client: 'ChatGPT',
  actor: 'oauth:ChatGPT',
  provider: 'OAuth',
  authType: 'OAuth',
  yolo: true,
  workspace: 'Aevra',
  workspaces: ['Aevra'],
  workspaceIds: ['ws-1'],
  capabilities: ['files.read'],
  status: 'active',
};

function mutationCall(
  fetchMock: ReturnType<typeof installApiFixtures>,
  path: string,
  method: string,
) {
  return fetchMock.mock.calls.find(([input, init]) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.pathname + input.search
          : input.url;
    return url === path && String(init?.method ?? 'GET').toUpperCase() === method;
  });
}

function renderModal(overrides: Partial<ActiveConnection> = {}) {
  const onClose = vi.fn();
  const onChanged = vi.fn(async () => undefined);
  render(
    <DialogProvider>
      <ConnectionDetailModal
        connection={{ ...connection, ...overrides }}
        workspaces={workspaces}
        onClose={onClose}
        onChanged={onChanged}
      />
    </DialogProvider>,
  );
  return { onClose, onChanged };
}

function grantControls() {
  const buttons = screen.getAllByRole('button', { name: 'Grant workspace' });
  const trigger = buttons.find((button) => button.getAttribute('aria-haspopup') === 'listbox')!;
  const confirm = buttons.find((button) => button.getAttribute('aria-haspopup') !== 'listbox')!;
  return { trigger, confirm };
}

test('renders nothing without a selected connection', () => {
  render(
    <DialogProvider>
      <ConnectionDetailModal
        connection={null}
        workspaces={workspaces}
        onClose={vi.fn()}
        onChanged={vi.fn(async () => undefined)}
      />
    </DialogProvider>,
  );
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('shows session details with granted workspaces and remaining grant options', () => {
  installApiFixtures();
  renderModal();

  const dialog = screen.getByRole('dialog', { name: 'ChatGPT' });
  expect(within(dialog).getAllByText('OAuth').length).toBeGreaterThan(0);
  expect(within(dialog).getByText('YOLO')).toBeInTheDocument();
  expect(within(dialog).getByText('active')).toBeInTheDocument();
  expect(within(dialog).getByText('Aevra')).toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  expect(within(dialog).getByLabelText('Grant workspace')).toBeInTheDocument();
});

test('falls back to Confirm mode and hidden details for sparse connections', () => {
  installApiFixtures();
  renderModal({
    yolo: false,
    remoteIp: null,
    provider: undefined,
    authType: undefined,
    status: undefined,
  });

  const dialog = screen.getByRole('dialog', { name: 'ChatGPT' });
  expect(within(dialog).getByText('Remote session')).toBeInTheDocument();
  expect(within(dialog).getByText('Unknown')).toBeInTheDocument();
  expect(within(dialog).getByText('Confirm')).toBeInTheDocument();
  expect(within(dialog).getByText('Hidden')).toBeInTheDocument();
  expect(within(dialog).getByText('active')).toBeInTheDocument();
});

test('removes a granted workspace through the delete endpoint', async () => {
  const user = userEvent.setup();
  const fetchMock = installApiFixtures();
  const { onChanged } = renderModal();

  await user.click(screen.getByRole('button', { name: 'Remove' }));
  await waitFor(() =>
    expect(
      mutationCall(fetchMock, '/api/sessions/ses-chatgpt/workspace/ws-1', 'DELETE'),
    ).toBeTruthy(),
  );
  await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
});

test('grants an ungranted workspace with a bounded timeout', async () => {
  const user = userEvent.setup();
  const fetchMock = installApiFixtures();
  const { onChanged } = renderModal({ workspaceIds: [] });

  await user.click(grantControls().confirm);
  await waitFor(() =>
    expect(mutationCall(fetchMock, '/api/sessions/ses-chatgpt/workspace', 'POST')).toBeTruthy(),
  );
  const call = mutationCall(fetchMock, '/api/sessions/ses-chatgpt/workspace', 'POST');
  expect(JSON.parse(String(call?.[1]?.body))).toEqual({ workspaceId: 'ws-1', timeoutMs: 60000 });
  await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
});

test('disabling YOLO deletes the session flag without confirmation', async () => {
  const user = userEvent.setup();
  const fetchMock = installApiFixtures();
  renderModal({ yolo: true });

  await user.click(screen.getByRole('button', { name: 'Disable YOLO' }));
  await waitFor(() =>
    expect(mutationCall(fetchMock, '/api/sessions/ses-chatgpt/yolo', 'DELETE')).toBeTruthy(),
  );
  expect(screen.queryByRole('dialog', { name: 'Enable YOLO session?' })).not.toBeInTheDocument();
});

test('enabling YOLO requires the immutable approval acknowledgement first', async () => {
  const user = userEvent.setup();
  const fetchMock = installApiFixtures();
  renderModal({ yolo: false });

  await user.click(screen.getByRole('button', { name: 'Enable YOLO' }));
  const confirmDialog = screen.getByRole('dialog', { name: 'Enable YOLO session?' });
  await user.click(within(confirmDialog).getByRole('button', { name: 'Enable YOLO' }));

  await waitFor(() =>
    expect(mutationCall(fetchMock, '/api/sessions/ses-chatgpt/yolo', 'POST')).toBeTruthy(),
  );
});

test('cancelling the YOLO confirmation sends no request', async () => {
  const user = userEvent.setup();
  const fetchMock = installApiFixtures();
  renderModal({ yolo: false });

  await user.click(screen.getByRole('button', { name: 'Enable YOLO' }));
  const confirmDialog = screen.getByRole('dialog', { name: 'Enable YOLO session?' });
  await user.click(within(confirmDialog).getByRole('button', { name: 'Cancel' }));

  expect(mutationCall(fetchMock, '/api/sessions/ses-chatgpt/yolo', 'POST')).toBeUndefined();
});

test('revoking a session confirms first then closes the modal', async () => {
  const user = userEvent.setup();
  const fetchMock = installApiFixtures();
  const { onClose, onChanged } = renderModal();

  await user.click(screen.getByRole('button', { name: 'Revoke session' }));
  const confirmDialog = screen.getByRole('dialog', { name: 'Revoke session' });
  expect(confirmDialog).toHaveTextContent('Disconnect ChatGPT?');
  await user.click(within(confirmDialog).getByRole('button', { name: 'Revoke' }));

  await waitFor(() =>
    expect(mutationCall(fetchMock, '/api/sessions/ses-chatgpt/revoke', 'POST')).toBeTruthy(),
  );
  await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  expect(onClose).toHaveBeenCalled();
});

test('cancelling revocation keeps the modal open without mutations', async () => {
  const user = userEvent.setup();
  const fetchMock = installApiFixtures();
  const { onClose } = renderModal();

  await user.click(screen.getByRole('button', { name: 'Revoke session' }));
  const confirmDialog = screen.getByRole('dialog', { name: 'Revoke session' });
  await user.click(within(confirmDialog).getByRole('button', { name: 'Cancel' }));

  expect(mutationCall(fetchMock, '/api/sessions/ses-chatgpt/revoke', 'POST')).toBeUndefined();
  expect(onClose).not.toHaveBeenCalled();
});

test('mutation failures surface the server message inside the modal', async () => {
  const user = userEvent.setup();
  installApiFixtures({
    mutationResponses: {
      'POST /api/sessions/ses-chatgpt/workspace': new Response(
        JSON.stringify({ error: { code: 'BUSY', message: 'Workspace is busy' } }),
        { status: 409, headers: { 'content-type': 'application/json' } },
      ),
    },
  });
  renderModal();

  await user.click(grantControls().confirm);
  expect(await screen.findByText('Workspace is busy')).toHaveClass('warning');
});

test('backdrop and close button dismiss the modal without mutations', async () => {
  const user = userEvent.setup();
  installApiFixtures();
  const { onClose } = renderModal();

  await user.click(screen.getByRole('button', { name: 'Close' }));
  expect(onClose).toHaveBeenCalledTimes(1);

  await user.click(document.querySelector('.modal-backdrop') as HTMLElement);
  expect(onClose).toHaveBeenCalledTimes(2);
});
