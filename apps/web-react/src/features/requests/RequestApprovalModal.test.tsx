import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { DialogProvider } from '../../components/Dialog';
import { installApiFixtures } from '../../test/api-fixtures';
import { RequestApprovalModal } from './RequestApprovalModal';
import type { RequestsData } from './requests-service';

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

function makeData(overrides: Partial<RequestsData> = {}): RequestsData {
  return {
    approvals: [commandApproval as any],
    oauth: [],
    workspaces: [{ id: 'ws-1', name: 'Aevra', hostRoot: '/repo' }],
    ...overrides,
  };
}

function renderModal(data: RequestsData, onActioned = vi.fn().mockResolvedValue(undefined)) {
  const onDismiss = vi.fn();
  render(
    <DialogProvider>
      <RequestApprovalModal data={data} onActioned={onActioned} onDismiss={onDismiss} />
    </DialogProvider>,
  );
  return { onActioned, onDismiss };
}

test('approval modal shows request title, actor, and action buttons', () => {
  installApiFixtures();
  renderModal(makeData());

  expect(screen.getByText('ChatGPT requests commands.run')).toBeInTheDocument();
  expect(screen.getByText('ChatGPT')).toBeInTheDocument();
  expect(screen.getByText('$ git status --short')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Run once' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Deny' })).toBeInTheDocument();
  expect(screen.getByText('Approval request')).toBeInTheDocument();
});

test('approval modal shows pending count when multiple requests exist', () => {
  installApiFixtures();
  renderModal(
    makeData({
      oauth: [oauthRequest as any],
    }),
  );

  expect(screen.getByText(/2 pending/)).toBeInTheDocument();
});

test('approving once calls onActioned', async () => {
  const user = userEvent.setup();
  const fetchMock = installApiFixtures({ approvals: [commandApproval] });
  const onActioned = vi.fn().mockResolvedValue(undefined);
  renderModal(makeData(), onActioned);

  await user.click(screen.getByRole('button', { name: 'Run once' }));
  await waitFor(() =>
    expect(
      fetchMock.mock.calls.find(([url, init]) => {
        const path = typeof url === 'string' ? url : (url as Request).url;
        return path === '/api/approvals/approval-1/approve' && init?.method === 'POST';
      }),
    ).toBeTruthy(),
  );
  await waitFor(() => expect(onActioned).toHaveBeenCalledTimes(1));
});

test('denying calls onActioned', async () => {
  const user = userEvent.setup();
  const fetchMock = installApiFixtures({ approvals: [commandApproval] });
  const onActioned = vi.fn().mockResolvedValue(undefined);
  renderModal(makeData(), onActioned);

  await user.click(screen.getByRole('button', { name: 'Deny' }));
  await waitFor(() =>
    expect(
      fetchMock.mock.calls.find(([url, init]) => {
        const path = typeof url === 'string' ? url : (url as Request).url;
        return path === '/api/approvals/approval-1/deny' && init?.method === 'POST';
      }),
    ).toBeTruthy(),
  );
  await waitFor(() => expect(onActioned).toHaveBeenCalledTimes(1));
});

test('dismiss button calls onDismiss', async () => {
  const user = userEvent.setup();
  installApiFixtures();
  const { onDismiss } = renderModal(makeData());

  await user.click(screen.getByRole('button', { name: 'Dismiss approval modal' }));
  expect(onDismiss).toHaveBeenCalledTimes(1);
});

test('Escape key calls onDismiss', async () => {
  const user = userEvent.setup();
  installApiFixtures();
  const { onDismiss } = renderModal(makeData());

  await user.keyboard('{Escape}');
  expect(onDismiss).toHaveBeenCalledTimes(1);
});

test('approval modal receives focus and keeps Tab navigation inside the dialog', async () => {
  const user = userEvent.setup();
  installApiFixtures();
  renderModal(makeData());

  const dialog = screen.getByRole('dialog', { name: 'Approval request' });
  expect(dialog).toHaveFocus();

  await user.tab({ shift: true });
  expect(screen.getByRole('button', { name: 'Always globally' })).toHaveFocus();
});

test('OAuth approval modal shows allow and deny buttons', async () => {
  const user = userEvent.setup();
  const fetchMock = installApiFixtures({ oauth: [oauthRequest] });
  const onActioned = vi.fn().mockResolvedValue(undefined);
  renderModal(makeData({ approvals: [], oauth: [oauthRequest as any] }), onActioned);

  expect(screen.getByText('Claude')).toBeInTheDocument();
  expect(screen.getByText(/10\.0\.0\.8/)).toBeInTheDocument();
  expect(screen.getByText(/4321/)).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: 'Allow' }));
  await waitFor(() =>
    expect(
      fetchMock.mock.calls.find(([url, init]) => {
        const path = typeof url === 'string' ? url : (url as Request).url;
        return path === '/api/oauth/requests/oauth-1/approve' && init?.method === 'POST';
      }),
    ).toBeTruthy(),
  );
  await waitFor(() => expect(onActioned).toHaveBeenCalledTimes(1));
});

test('renders nothing when there are no pending requests', () => {
  installApiFixtures();
  const { container } = render(
    <DialogProvider>
      <RequestApprovalModal
        data={{ approvals: [], oauth: [], workspaces: [] }}
        onActioned={vi.fn()}
        onDismiss={vi.fn()}
      />
    </DialogProvider>,
  );
  expect(container.firstChild).toBeNull();
});
