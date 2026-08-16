import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { DialogProvider } from '../../components/Dialog';
import { installApiFixtures } from '../../test/api-fixtures';
import { RequestDrawer } from './RequestDrawer';

const commandApproval = {
  id: 'approval-1',
  state: 'PENDING',
  actor: 'ChatGPT',
  risk: 'MEDIUM',
  workspaceId: 'ws-1',
  sessionId: 'session-1',
  operation: { family: 'git:status:--short', capability: 'commands.run' },
  payload: { permissionMatcher: 'git:status:--short' },
  presentation: {
    title: 'ChatGPT requests commands.run',
    action: 'Run command',
    target: 'git status --short',
    preview: '$ git status --short',
  },
};

const oauthRequest = {
  id: 'oauth-1',
  clientId: 'client-1',
  clientName: 'Claude',
  pairingCode: '4321',
  remoteIp: '10.0.0.8',
};

function mutationCall(
  fetchMock: ReturnType<typeof installApiFixtures>,
  path: string,
  method = 'POST',
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

function renderDrawer(onPendingCountChange = vi.fn()) {
  render(
    <DialogProvider>
      <RequestDrawer open onClose={() => undefined} onPendingCountChange={onPendingCountChange} />
    </DialogProvider>,
  );
}

test('approving once posts scope once and reports the pending count', async () => {
  const user = userEvent.setup();
  const fetchMock = installApiFixtures({ approvals: [commandApproval] });
  const onPendingCountChange = vi.fn();

  renderDrawer(onPendingCountChange);
  expect(await screen.findByText('$ git status --short')).toBeInTheDocument();
  await waitFor(() => expect(onPendingCountChange).toHaveBeenCalledWith(1));

  await user.click(screen.getByRole('button', { name: 'Run once' }));
  await waitFor(() =>
    expect(mutationCall(fetchMock, '/api/approvals/approval-1/approve')).toBeTruthy(),
  );
  const call = mutationCall(fetchMock, '/api/approvals/approval-1/approve');
  expect(JSON.parse(String(call?.[1]?.body))).toEqual({ scope: 'once' });
});

test('denying posts an empty body to the deny endpoint', async () => {
  const user = userEvent.setup();
  const fetchMock = installApiFixtures({ approvals: [commandApproval] });
  renderDrawer();

  await screen.findByText('ChatGPT requests commands.run');
  await user.click(screen.getByRole('button', { name: 'Deny' }));
  await waitFor(() =>
    expect(mutationCall(fetchMock, '/api/approvals/approval-1/deny')).toBeTruthy(),
  );
  expect(String(mutationCall(fetchMock, '/api/approvals/approval-1/deny')?.[1]?.body)).toBe('{}');
});

test('critical non-command requests offer only Deny and Allow with fallback presentation', async () => {
  installApiFixtures({
    approvals: [
      {
        id: 'approval-2',
        state: 'PENDING',
        actor: 'connector:Claude',
        risk: 'CRITICAL',
        workspaceId: 'ws-1',
        operation: { family: 'files.write', capability: 'files.write' },
      },
    ],
  });
  renderDrawer();

  expect((await screen.findAllByText('files.write')).length).toBeGreaterThan(0);
  expect(screen.getByText('Aevra')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Allow' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Deny' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Run once' })).not.toBeInTheDocument();
  expect(screen.queryByText('Saved matcher')).not.toBeInTheDocument();
});

test('OAuth cards expose allow and deny decisions for every listed request', async () => {
  const user = userEvent.setup();
  const fetchMock = installApiFixtures({
    oauth: [oauthRequest, { id: 'oauth-2', clientId: 'client-9', pairingCode: '0000' }],
  });
  renderDrawer();

  expect(await screen.findByText('Claude')).toBeInTheDocument();
  expect(screen.getByText(/10\.0\.0\.8/)).toBeInTheDocument();
  expect(screen.getByText('client-9')).toBeInTheDocument();
  expect(screen.getByText(/Remote client/)).toBeInTheDocument();

  await user.click(screen.getAllByRole('button', { name: 'Allow' })[0]!);
  await waitFor(() =>
    expect(mutationCall(fetchMock, '/api/oauth/requests/oauth-1/approve')).toBeTruthy(),
  );

  await user.click(screen.getAllByRole('button', { name: 'Deny' })[1]!);
  await waitFor(() =>
    expect(mutationCall(fetchMock, '/api/oauth/requests/oauth-2/deny')).toBeTruthy(),
  );
});

test('history tab lists resolved approvals while an empty pending tab explains itself', async () => {
  const user = userEvent.setup();
  installApiFixtures({
    approvals: [
      {
        ...commandApproval,
        id: 'approval-done',
        state: 'APPROVED',
        payload: {},
      },
    ],
  });
  renderDrawer();

  await screen.findByText('No pending requests');
  await user.click(screen.getByRole('button', { name: /History/ }));

  const table = document.querySelector<HTMLElement>('[data-table-id="react-request-history"]');
  expect(table).not.toBeNull();
  expect(await screen.findByText('APPROVED')).toBeInTheDocument();
  expect(screen.getAllByText('git:status:--short').length).toBeGreaterThan(0);
});

test('browser notification control requests permission and reports the granted state', async () => {
  class FakeNotification {
    static permission = 'default';
    static requestPermission = vi.fn(async () => 'granted');
  }
  vi.stubGlobal('Notification', FakeNotification);
  const user = userEvent.setup();
  installApiFixtures();

  renderDrawer();
  const enableButton = screen.getByRole('button', { name: 'Enable browser notifications' });
  expect(enableButton).toBeEnabled();
  await user.click(enableButton);

  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Browser notifications enabled' })).toBeDisabled(),
  );
  expect(FakeNotification.requestPermission).toHaveBeenCalledTimes(1);
});

test('blocked notifications disable the control without requesting again', () => {
  class BlockedNotification {
    static permission = 'denied';
  }
  vi.stubGlobal('Notification', BlockedNotification);
  installApiFixtures();

  renderDrawer();
  expect(screen.getByRole('button', { name: 'Browser notifications blocked' })).toBeDisabled();
});
