import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { DialogProvider } from '../../components/Dialog';
import { installApiFixtures } from '../../test/api-fixtures';
import { ConnectionDetailModal } from './ConnectionDetailModal';

test('durable OAuth connection shows continuity metadata and revokes credentials', async () => {
  const user = userEvent.setup();
  const fetchMock = installApiFixtures();
  const onClose = vi.fn();
  render(
    <DialogProvider>
      <ConnectionDetailModal
        connection={{
          id: 'oauth_grant_1',
          connectionId: 'oauth_grant_1',
          client: 'ChatGPT',
          actor: 'oauth:ChatGPT',
          provider: 'OAuth',
          authType: 'OAuth',
          status: 'OFFLINE',
          yolo: true,
          sessionCount: 0,
          lastUsedAt: '2026-08-26T00:00:00.000Z',
          accessTokenLifetimeSeconds: 3600,
          refreshFamilyExpiresAt: '2026-09-25T00:00:00.000Z',
          workspaceIds: [],
        }}
        workspaces={[]}
        onClose={onClose}
        onChanged={vi.fn(async () => undefined)}
      />
    </DialogProvider>,
  );

  expect(screen.getByText('Offline / reconnectable')).toBeInTheDocument();
  expect(screen.getByText('60 min lifetime')).toBeInTheDocument();
  expect(screen.getByText('Enabled')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Enable YOLO' })).not.toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: 'Revoke connection' }));
  const confirm = screen.getByRole('dialog', { name: 'Revoke connection' });
  await user.click(within(confirm).getByRole('button', { name: 'Revoke connection' }));

  await waitFor(() => {
    const mutation = fetchMock.mock.calls.find(([input, init]) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
      return (
        url === '/api/connections/oauth_grant_1/revoke' &&
        String(init?.method ?? 'GET').toUpperCase() === 'POST'
      );
    });
    expect(mutation).toBeTruthy();
  });
  expect(onClose).toHaveBeenCalled();
});
