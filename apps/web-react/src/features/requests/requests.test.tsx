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
  operation: { family: 'git:status:--short', capability: 'commands.run' },
  payload: { permissionMatcher: 'git:status:--short' },
  presentation: {
    title: 'ChatGPT requests commands.run',
    action: 'Run command',
    target: 'git status --short',
  },
};

function renderDrawer(onPendingCountChange = vi.fn()) {
  render(
    <DialogProvider>
      <RequestDrawer open onClose={() => undefined} onPendingCountChange={onPendingCountChange} />
    </DialogProvider>,
  );
  return onPendingCountChange;
}

test('non-critical command shows once session workspace global and Saved matcher', async () => {
  installApiFixtures({ approvals: [commandApproval] });
  renderDrawer();
  expect(await screen.findByText('ChatGPT requests commands.run')).toBeInTheDocument();
  expect(screen.getByText('Saved matcher')).toBeInTheDocument();
  expect(screen.getByText('git:status:--short')).toBeInTheDocument();
  for (const label of [
    'Run once',
    'Allow this session',
    'Always in workspace',
    'Always globally',
  ]) {
    expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
  }
});

test('CRITICAL command exposes only Deny and Run once', async () => {
  installApiFixtures({
    approvals: [{ ...commandApproval, id: 'critical-1', risk: 'CRITICAL' }],
  });
  renderDrawer();
  await screen.findByText('ChatGPT requests commands.run');
  expect(screen.getByRole('button', { name: 'Run once' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Deny' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Allow this session' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Always in workspace' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Always globally' })).not.toBeInTheDocument();
});

test('YOLO action explains immutable security approvals and uses the dedicated treatment', async () => {
  const user = userEvent.setup();
  installApiFixtures({
    approvals: [
      {
        ...commandApproval,
        id: 'yolo-1',
        actor: 'oauth:ChatGPT',
        sessionId: 'session-1',
      },
    ],
  });
  renderDrawer();
  const trigger = await screen.findByRole('button', { name: 'Enable YOLO' });
  expect(trigger).toHaveClass('yolo-action');
  await user.click(trigger);
  expect(
    screen.getByText('YOLO enabled — immutable security approvals still require confirmation'),
  ).toBeInTheDocument();
  const buttons = screen.getAllByRole('button', { name: 'Enable YOLO' });
  expect(
    buttons.some(
      (button) =>
        button.closest('.common-dialog') !== null && button.classList.contains('yolo-action'),
    ),
  ).toBe(true);
});

test('request owner reports pending approval plus OAuth count to the shell', async () => {
  installApiFixtures({
    approvals: [commandApproval],
    oauth: [
      {
        id: 'oauth-1',
        clientId: 'client-1',
        clientName: 'Claude',
        pairingCode: '1234',
      },
    ],
  });
  const onPendingCountChange = renderDrawer(vi.fn());
  await waitFor(() => expect(onPendingCountChange).toHaveBeenCalledWith(2));
});
