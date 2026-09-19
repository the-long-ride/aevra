import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { DialogProvider } from '../../components/Dialog';
import { installApiFixtures } from '../../test/api-fixtures';
import type { DashboardData } from './dashboard-service';
import { RuntimeManagementModal } from './RuntimeManagementModal';

const sampleData: DashboardData = {
  snapshot: {
    metrics: [
      { tool: 'files.read', calls: 42, avgMs: 12, totalMs: 504 },
      { tool: 'commands.run', calls: 5, avgMs: 120, totalMs: 600 },
    ],
    connectors: [
      {
        id: 'conn-revocable',
        name: 'Revocable Connector',
        authType: 'oauth',
        createdAt: '2026-09-19T00:00:00.000Z',
        lastUsedAt: '2026-09-19T01:00:00.000Z',
        revocable: true,
      },
      {
        id: 'conn-static',
        name: 'Static Connector',
        authType: 'static',
        createdAt: '2026-09-19T00:00:00.000Z',
        lastUsedAt: null,
        revocable: false,
      },
    ],
  } as any,
  onboarding: { completed: true, completedSections: [] } as any,
  exposure: { state: 'ready' } as any,
  workspaces: [],
};

describe('RuntimeManagementModal', () => {
  test('renders null when kind is null', () => {
    const { container } = render(
      <DialogProvider>
        <RuntimeManagementModal
          kind={null}
          data={sampleData}
          onClose={vi.fn()}
          onRefresh={vi.fn()}
          onCreateConnector={vi.fn()}
        />
      </DialogProvider>,
    );
    expect(container.firstChild).toBeNull();
  });

  test('renders processes, changes, and tools panels', () => {
    installApiFixtures({
      routes: {
        '/api/processes': [],
        '/api/changes': [],
      },
    });

    const { rerender } = render(
      <DialogProvider>
        <RuntimeManagementModal
          kind="processes"
          data={sampleData}
          onClose={vi.fn()}
          onRefresh={vi.fn()}
          onCreateConnector={vi.fn()}
        />
      </DialogProvider>,
    );
    expect(screen.getByRole('dialog', { name: 'Managed processes' })).toBeInTheDocument();

    rerender(
      <DialogProvider>
        <RuntimeManagementModal
          kind="changes"
          data={sampleData}
          onClose={vi.fn()}
          onRefresh={vi.fn()}
          onCreateConnector={vi.fn()}
        />
      </DialogProvider>,
    );
    expect(screen.getByRole('dialog', { name: 'Open changes' })).toBeInTheDocument();

    rerender(
      <DialogProvider>
        <RuntimeManagementModal
          kind="tools"
          data={sampleData}
          onClose={vi.fn()}
          onRefresh={vi.fn()}
          onCreateConnector={vi.fn()}
        />
      </DialogProvider>,
    );
    expect(screen.getByRole('dialog', { name: 'Tool calls' })).toBeInTheDocument();
    expect(screen.getByText('files.read')).toBeInTheDocument();
    expect(screen.getByText('commands.run')).toBeInTheDocument();
  });

  test('handles connectors panel, new connector action, and connector revocation with cancel and confirm', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const onCreateConnector = vi.fn();
    const fetchMock = installApiFixtures({
      mutationResponses: {
        'DELETE /api/connectors/conn-revocable': new Response('{}', { status: 200 }),
      },
    });

    render(
      <DialogProvider>
        <RuntimeManagementModal
          kind="connectors"
          data={sampleData}
          onClose={onClose}
          onRefresh={onRefresh}
          onCreateConnector={onCreateConnector}
        />
      </DialogProvider>,
    );

    const dialog = screen.getByRole('dialog', { name: 'Connectors' });
    expect(dialog).toBeInTheDocument();

    // Trigger onCreateConnector
    await user.click(within(dialog).getByRole('button', { name: 'New connector' }));
    expect(onCreateConnector).toHaveBeenCalledOnce();

    // Non-revocable connector row has no revoke button
    const staticRow = within(dialog).getByText('Static Connector').closest('tr')!;
    expect(within(staticRow).queryByRole('button', { name: 'Revoke' })).toBeNull();

    // Revocable connector row
    const revocableRow = within(dialog).getByText('Revocable Connector').closest('tr')!;
    const revokeBtn = within(revocableRow).getByRole('button', { name: 'Revoke' });

    // Cancel revoke
    await user.click(revokeBtn);
    let confirmDialog = screen.getByRole('dialog', { name: 'Revoke connector' });
    await user.click(within(confirmDialog).getByRole('button', { name: 'Cancel' }));
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) => String(url).includes('/api/connectors') && init?.method === 'DELETE',
      ),
    ).toBe(false);

    // Confirm revoke
    await user.click(revokeBtn);
    confirmDialog = screen.getByRole('dialog', { name: 'Revoke connector' });
    await user.click(within(confirmDialog).getByRole('button', { name: 'Revoke' }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) => url === '/api/connectors/conn-revocable' && init?.method === 'DELETE',
        ),
      ).toBe(true);
      expect(onRefresh).toHaveBeenCalledOnce();
    });
  });
});
