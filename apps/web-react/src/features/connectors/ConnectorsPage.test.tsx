import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { DialogProvider } from '../../components/Dialog';
import { installApiFixtures } from '../../test/api-fixtures';
import { ConnectorsPage } from './ConnectorsPage';

describe('ConnectorsPage', () => {
  beforeEach(() => {
    installApiFixtures();
  });

  function mount() {
    return render(
      <DialogProvider>
        <ConnectorsPage />
      </DialogProvider>,
    );
  }

  test('renders page title, subtitle, and new connector button', async () => {
    mount();
    expect(
      await screen.findByRole('heading', { name: 'Connectors', level: 2 }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Client connectors, authentication, and access grants.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New connector' })).toBeInTheDocument();
  });

  test('displays both connected and disconnected connectors with status badges', async () => {
    mount();
    // ChatGPT is active in fixtures (CONNECTED)
    expect(await screen.findByText('ChatGPT')).toBeInTheDocument();
    // Static client is in fixtures (DISCONNECTED)
    expect(screen.getByText('Static client')).toBeInTheDocument();

    const connectedBadge = screen.getByText('CONNECTED');
    expect(connectedBadge).toHaveClass('badge', 'good');

    const disconnectedBadge = screen.getByText('DISCONNECTED');
    expect(disconnectedBadge).toHaveClass('badge', 'muted');
  });

  test('shows YOLO mode warning and badge when applicable', async () => {
    mount();
    expect(
      await screen.findByText(
        'YOLO enabled — immutable security approvals still require confirmation',
      ),
    ).toBeInTheDocument();
    expect(screen.getByTitle(/YOLO enabled/)).toHaveTextContent('YOLO');
  });

  test('handles selection controls and bulk revoke', async () => {
    const fetchMock = installApiFixtures({
      mutationResponses: {
        'DELETE /api/connectors/connector-1': { ok: true },
        'POST /api/sessions/ses-chatgpt/revoke': { ok: true },
      },
    });
    const user = userEvent.setup();
    mount();

    await screen.findByText('ChatGPT');
    const selectAllBtn = screen.getByRole('button', { name: 'Select all' });
    const unselectAllBtn = screen.getByRole('button', { name: 'Unselect all' });
    const revokeSelectedBtn = screen.getByRole('button', { name: 'Revoke selected' });

    expect(revokeSelectedBtn).toBeDisabled();

    // Select all
    await user.click(selectAllBtn);
    expect(screen.getByText(/2 selected/)).toBeInTheDocument();
    expect(revokeSelectedBtn).toBeEnabled();

    // Unselect all
    await user.click(unselectAllBtn);
    expect(screen.getByText('Select one or more connectors to revoke')).toBeInTheDocument();
    expect(revokeSelectedBtn).toBeDisabled();

    // Select individual switch
    const switchEl = screen.getByRole('switch', { name: 'Select Static client' });
    await user.click(switchEl);
    expect(screen.getByText(/1 selected/)).toBeInTheDocument();
    expect(revokeSelectedBtn).toBeEnabled();

    // Click revoke selected
    await user.click(revokeSelectedBtn);
    const confirmModal = await screen.findByRole('dialog', { name: 'Revoke selected connectors' });
    expect(confirmModal).toBeInTheDocument();

    // Confirm revocation
    await user.click(within(confirmModal).getByRole('button', { name: 'Revoke selected' }));

    await waitFor(() => {
      const calls = fetchMock.mock.calls.map((c) => String(c[0]));
      expect(calls.some((url) => url.includes('/api/connectors/connector-1'))).toBe(true);
    });

    expect(await screen.findByRole('status')).toHaveTextContent('1 connector revoked.');
  });

  test('handles single connector revocation with cancel and confirm', async () => {
    const fetchMock = installApiFixtures({
      mutationResponses: {
        'DELETE /api/connectors/connector-1': { ok: true },
      },
    });
    const user = userEvent.setup();
    mount();

    await screen.findByText('Static client');
    const staticRow = screen.getByText('Static client').closest('tr')!;
    const revokeBtn = within(staticRow).getByRole('button', { name: 'Revoke' });

    // Cancel
    await user.click(revokeBtn);
    const cancelModal = await screen.findByRole('dialog', { name: 'Revoke connector' });
    await user.click(within(cancelModal).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog', { name: 'Revoke connector' })).not.toBeInTheDocument();

    // Confirm
    await user.click(revokeBtn);
    const confirmModal = await screen.findByRole('dialog', { name: 'Revoke connector' });
    await user.click(within(confirmModal).getByRole('button', { name: 'Revoke' }));

    await waitFor(() => {
      const calls = fetchMock.mock.calls.map((c) => String(c[0]));
      expect(calls.some((url) => url.includes('/api/connectors/connector-1'))).toBe(true);
    });

    expect(await screen.findByRole('status')).toHaveTextContent('Connector revoked.');
  });

  test('handles OAuth client revocation from table', async () => {
    const fetchMock = installApiFixtures({
      mutationResponses: {
        'DELETE /api/oauth/clients/oauth_grok?force=true': { ok: true },
      },
      routes: {
        '/api/connectors': [],
        '/api/connections': [],
        '/api/dashboard/runtime': {
          status: { version: '0.1.0' },
          uptimeSeconds: 100,
          pending: { total: 0 },
          stats: {
            sessions: 0,
            workspaceLeases: 0,
            processes: 0,
            openChanges: 0,
            toolCalls: 0,
            avgToolLatencyMs: null,
            connectors: 1,
          },
          power: null,
          system: {
            detectedAt: '2026-08-27T12:00:00.000Z',
            os: { platform: 'windows' },
            runtime: { node: '24.7.0' },
            tools: [],
          },
          transport: { state: 'secure' },
          metrics: [],
          activeConnections: [],
          connectors: [
            {
              id: 'oauth_grok',
              clientId: 'oauth_grok',
              name: 'Grok',
              authType: 'OAuth',
              revocable: true,
            },
          ],
        },
      },
    });

    const user = userEvent.setup();
    mount();

    await screen.findByText('Grok');
    const grokRow = screen.getByText('Grok').closest('tr')!;
    const revokeBtn = within(grokRow).getByRole('button', { name: 'Revoke' });

    await user.click(revokeBtn);
    const confirmModal = await screen.findByRole('dialog', { name: 'Revoke connector' });
    await user.click(within(confirmModal).getByRole('button', { name: 'Revoke' }));

    await waitFor(() => {
      const calls = fetchMock.mock.calls.map((c: any) => String(c[0]));
      expect(calls.some((url: string) => url.includes('/api/oauth/clients/oauth_grok'))).toBe(true);
    });

    expect(await screen.findByRole('status')).toHaveTextContent('Connector revoked.');
  });

  test('opens details modal when clicking Details', async () => {
    const user = userEvent.setup();
    mount();

    await screen.findByText('ChatGPT');
    const chatGptRow = screen.getByText('ChatGPT').closest('tr')!;
    const detailsBtn = within(chatGptRow).getByRole('button', { name: 'Details' });

    await user.click(detailsBtn);
    expect(await screen.findByRole('dialog', { name: 'ChatGPT' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog', { name: 'ChatGPT' })).not.toBeInTheDocument();
  });

  test('opens new connector modal when clicking New connector', async () => {
    const user = userEvent.setup();
    mount();

    await screen.findByText('New connector');
    await user.click(screen.getByRole('button', { name: 'New connector' }));

    expect(
      await screen.findByRole('dialog', { name: 'Create Bearer connector' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(
      screen.queryByRole('dialog', { name: 'Create Bearer connector' }),
    ).not.toBeInTheDocument();
  });

  test('displays capabilities dialog when clicking capabilities pill', async () => {
    const user = userEvent.setup();
    mount();

    const capBtn = await screen.findByTitle('files.read');
    await user.click(capBtn);

    const capsModal = await screen.findByRole('dialog', { name: 'Capabilities' });
    expect(capsModal).toBeInTheDocument();
    expect(within(capsModal).getByText('files.read')).toBeInTheDocument();

    await user.click(within(capsModal).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog', { name: 'Capabilities' })).not.toBeInTheDocument();
  });
});
