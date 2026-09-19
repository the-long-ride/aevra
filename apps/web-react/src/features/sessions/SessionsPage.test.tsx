import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test } from 'vitest';
import { DialogProvider } from '../../components/Dialog';
import { installApiFixtures } from '../../test/api-fixtures';
import { SessionsPage } from './SessionsPage';

const fixtures = {
  routes: {
    '/api/sessions': [
      {
        id: 'ses-1',
        actor: 'connector:ChatGPT',
        activeLeaseId: 'lease-1',
        lease: { workspaceId: 'ws-1' },
        lastActivityAt: '2026-09-18T10:00:00.000Z',
      },
    ],
    '/api/admin-sessions': [
      {
        idHash: 'hash-abc',
        createdAt: '2026-09-18T09:00:00.000Z',
        lastUsedAt: '2026-09-18T10:00:00.000Z',
      },
    ],
    '/api/workspaces': [{ id: 'ws-1', name: 'Primary Repo', hostRoot: '/repo' }],
  },
  mutationResponses: {
    'POST /api/sessions/ses-1/workspace': new Response('{}', { status: 200 }),
    'POST /api/sessions/ses-1/revoke': new Response('{}', { status: 200 }),
    'POST /api/admin-sessions/hash-abc/revoke': new Response('{}', { status: 200 }),
    'POST /api/sessions/revoke-others': new Response('{}', { status: 200 }),
  },
};

describe('SessionsPage', () => {
  test('renders remote and local sessions and handles switch workspace with cancel and submit', async () => {
    const user = userEvent.setup();
    const fetchMock = installApiFixtures(fixtures);

    render(
      <DialogProvider>
        <SessionsPage />
      </DialogProvider>,
    );

    expect(await screen.findByRole('heading', { name: 'Sessions' })).toBeInTheDocument();
    expect(screen.getByText('connector:ChatGPT')).toBeInTheDocument();
    expect(screen.getByText('Workspace active')).toBeInTheDocument();
    expect(screen.getByText('hash-abc')).toBeInTheDocument();

    // 1. Switch workspace - Cancel
    const switchBtn = screen.getByRole('button', { name: 'Switch' });
    await user.click(switchBtn);
    let promptDialog = screen.getByRole('dialog', { name: 'Switch workspace' });
    await user.click(within(promptDialog).getByRole('button', { name: 'Cancel' }));
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) => String(url).includes('/workspace') && init?.method === 'POST',
      ),
    ).toBe(false);

    // 2. Switch workspace - Confirm
    await user.click(switchBtn);
    promptDialog = screen.getByRole('dialog', { name: 'Switch workspace' });
    const input = within(promptDialog).getByRole('textbox');
    await user.type(input, 'ws-2');
    await user.click(within(promptDialog).getByRole('button', { name: 'Switch' }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([url, init]) => url === '/api/sessions/ses-1/workspace' && init?.method === 'POST',
      );
      expect(call).toBeTruthy();
      expect(JSON.parse(String(call?.[1]?.body))).toEqual({
        workspaceId: 'ws-2',
        timeoutMs: 60000,
      });
    });
  });

  test('revokes remote session with cancel and confirm', async () => {
    const user = userEvent.setup();
    const fetchMock = installApiFixtures(fixtures);

    render(
      <DialogProvider>
        <SessionsPage />
      </DialogProvider>,
    );

    await screen.findByText('connector:ChatGPT');
    // First Revoke button is for remote session
    const revokeButtons = screen.getAllByRole('button', { name: 'Revoke' });
    const remoteRevokeBtn = revokeButtons[0];

    // Cancel
    await user.click(remoteRevokeBtn);
    let dialog = screen.getByRole('dialog', { name: 'Revoke session' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) => String(url).includes('/revoke') && init?.method === 'POST',
      ),
    ).toBe(false);

    // Confirm
    await user.click(remoteRevokeBtn);
    dialog = screen.getByRole('dialog', { name: 'Revoke session' });
    await user.click(within(dialog).getByRole('button', { name: 'Revoke' }));
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) => url === '/api/sessions/ses-1/revoke' && init?.method === 'POST',
        ),
      ).toBe(true);
    });
  });

  test('revokes local admin session with cancel and confirm', async () => {
    const user = userEvent.setup();
    const fetchMock = installApiFixtures(fixtures);

    render(
      <DialogProvider>
        <SessionsPage />
      </DialogProvider>,
    );

    await screen.findByText('hash-abc');
    // Second Revoke button is for local admin session
    const revokeButtons = screen.getAllByRole('button', { name: 'Revoke' });
    const localRevokeBtn = revokeButtons[1];

    // Cancel
    await user.click(localRevokeBtn);
    let dialog = screen.getByRole('dialog', { name: 'Revoke admin session' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) => String(url).includes('/admin-sessions') && init?.method === 'POST',
      ),
    ).toBe(false);

    // Confirm
    await user.click(localRevokeBtn);
    dialog = screen.getByRole('dialog', { name: 'Revoke admin session' });
    await user.click(within(dialog).getByRole('button', { name: 'Revoke' }));
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) => url === '/api/admin-sessions/hash-abc/revoke' && init?.method === 'POST',
        ),
      ).toBe(true);
    });
  });

  test('revokes all other sessions with cancel and confirm', async () => {
    const user = userEvent.setup();
    const fetchMock = installApiFixtures(fixtures);

    render(
      <DialogProvider>
        <SessionsPage />
      </DialogProvider>,
    );

    const revokeOthersBtn = await screen.findByRole('button', { name: 'Revoke all others' });

    // Cancel
    await user.click(revokeOthersBtn);
    let dialog = screen.getByRole('dialog', { name: 'Revoke other sessions' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) => url === '/api/sessions/revoke-others' && init?.method === 'POST',
      ),
    ).toBe(false);

    // Confirm
    await user.click(revokeOthersBtn);
    dialog = screen.getByRole('dialog', { name: 'Revoke other sessions' });
    await user.click(within(dialog).getByRole('button', { name: 'Revoke' }));
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) => url === '/api/sessions/revoke-others' && init?.method === 'POST',
        ),
      ).toBe(true);
    });
  });
});
