import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
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

beforeEach(() => installApiFixtures());

function renderDrawer(onPendingCountChange = vi.fn()) {
  render(
    <RequestDrawer open onClose={() => undefined} onPendingCountChange={onPendingCountChange} />,
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
