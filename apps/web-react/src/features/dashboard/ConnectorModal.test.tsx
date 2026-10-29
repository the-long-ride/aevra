import type { WorkspaceSummary } from '@aevra/admin-contracts';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { installApiFixtures } from '../../test/api-fixtures';
import { ConnectorModal } from './ConnectorModal';

describe('ConnectorModal', () => {
  beforeEach(() => {
    installApiFixtures();
  });

  const mockWorkspaces: WorkspaceSummary[] = [
    {
      id: 'ws-1',
      name: 'Alpha Workspace',
      hostRoot: '/projects/alpha',
    },
    {
      id: 'ws-2',
      name: 'Beta Workspace',
      hostRoot: '/projects/beta',
    },
  ];

  test('renders form with name, connection type, workspace binding, and capability ceiling', () => {
    render(
      <ConnectorModal
        open={true}
        onClose={vi.fn()}
        onCreated={vi.fn().mockResolvedValue(undefined)}
        workspaces={mockWorkspaces}
      />,
    );

    expect(screen.getByRole('dialog', { name: 'Create Bearer connector' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Connector name')).toBeInTheDocument();
    expect(screen.getByLabelText('Connection type')).toBeInTheDocument();
    expect(screen.getByLabelText('Workspace binding')).toBeInTheDocument();
    expect(screen.getByLabelText('Capability ceiling')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '+ Grant workspace…' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Alpha Workspace (/projects/alpha)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create token' })).toBeInTheDocument();
  });

  test('submits selected workspace, capability ceiling, and displays token and HTTP snippet', async () => {
    const fetchMock = installApiFixtures({
      mutationResponses: {
        'POST /api/connectors': { token: 'tok_alpha_12345' },
      },
    });
    const onCreated = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    const user = userEvent.setup();
    const writeSpy = vi.spyOn(navigator.clipboard, 'writeText');

    render(
      <ConnectorModal
        open={true}
        onClose={onClose}
        onCreated={onCreated}
        workspaces={mockWorkspaces}
      />,
    );

    await user.type(screen.getByPlaceholderText('Connector name'), 'Agent-1');
    await user.selectOptions(screen.getByLabelText('Workspace binding'), 'ws-1');
    await user.selectOptions(screen.getByLabelText('Capability ceiling'), 'read-only');

    await user.click(screen.getByRole('button', { name: 'Create token' }));

    await waitFor(() => {
      const calls = fetchMock.mock.calls;
      const postCall = calls.find(
        (c) => String(c[0]).includes('/api/connectors') && (c[1] as any)?.method === 'POST',
      );
      expect(postCall).toBeDefined();
      const body = JSON.parse((postCall![1] as any).body);
      expect(body).toEqual({
        name: 'Agent-1',
        workspaceId: 'ws-1',
        profileCap: 'read-only',
      });
    });

    expect(await screen.findByText('Copy this token now. It is shown once.')).toBeInTheDocument();
    expect(screen.getByText('tok_alpha_12345')).toBeInTheDocument();
    expect(screen.getByText(/MCP client configuration/)).toBeInTheDocument();
    expect(screen.getByText('Local configuration')).toBeInTheDocument();
    expect(screen.getByText('Tunnel / Remote configuration')).toBeInTheDocument();
    expect(onCreated).toHaveBeenCalledTimes(1);

    // Copy actions
    await user.click(screen.getByRole('button', { name: 'Copy token' }));
    expect(writeSpy).toHaveBeenCalledWith('tok_alpha_12345');

    await user.click(screen.getByRole('button', { name: 'Copy local snippet' }));
    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining('http://localhost:3000/mcp'));

    await user.click(screen.getByRole('button', { name: 'Copy tunnel snippet' }));
    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining('/mcp'));

    // Close button closes modal
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('selecting stdio transport displays local process snippet and agent integrations tip', async () => {
    installApiFixtures({
      mutationResponses: {
        'POST /api/connectors': { token: 'tok_stdio_999' },
      },
    });
    const user = userEvent.setup();

    render(
      <ConnectorModal
        open={true}
        onClose={vi.fn()}
        onCreated={vi.fn().mockResolvedValue(undefined)}
        workspaces={mockWorkspaces}
      />,
    );

    await user.type(screen.getByPlaceholderText('Connector name'), 'LocalAgent');
    await user.selectOptions(screen.getByLabelText('Connection type'), 'stdio');
    await user.click(screen.getByRole('button', { name: 'Create token' }));

    expect(await screen.findByText('Copy this token now. It is shown once.')).toBeInTheDocument();
    expect(screen.getByText(/Local process configuration \(stdio\)/)).toBeInTheDocument();
    expect(screen.getByText(/Settings → Agent Integrations/)).toBeInTheDocument();
  });

  test('allows adding and revoking multiple workspaces before creating connector', async () => {
    const fetchMock = installApiFixtures({
      mutationResponses: {
        'POST /api/connectors': { token: 'tok_multi_ws' },
      },
    });
    const user = userEvent.setup();

    render(
      <ConnectorModal
        open={true}
        onClose={vi.fn()}
        onCreated={vi.fn().mockResolvedValue(undefined)}
        workspaces={mockWorkspaces}
      />,
    );

    expect(
      screen.getByText('No workspaces granted (default: none granted).'),
    ).toBeInTheDocument();

    // Add Alpha Workspace
    await user.selectOptions(screen.getByLabelText('Workspace binding'), 'ws-1');
    expect(screen.getByText('Alpha Workspace (/projects/alpha)')).toBeInTheDocument();

    // Add Beta Workspace
    await user.selectOptions(screen.getByLabelText('Workspace binding'), 'ws-2');
    expect(screen.getByText('Beta Workspace (/projects/beta)')).toBeInTheDocument();

    // Revoke Alpha Workspace
    await user.click(screen.getByRole('button', { name: 'Revoke Alpha Workspace' }));
    expect(screen.queryByRole('button', { name: 'Revoke Alpha Workspace' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Revoke Beta Workspace' })).toBeInTheDocument();

    // Submit with remaining granted workspace
    await user.type(screen.getByPlaceholderText('Connector name'), 'Agent-Multi');
    await user.click(screen.getByRole('button', { name: 'Create token' }));

    await waitFor(() => {
      const calls = fetchMock.mock.calls;
      const postCall = calls.find(
        (c) => String(c[0]).includes('/api/connectors') && (c[1] as any)?.method === 'POST',
      );
      expect(postCall).toBeDefined();
      const body = JSON.parse((postCall![1] as any).body);
      expect(body).toEqual({
        name: 'Agent-Multi',
        workspaceId: 'ws-2',
      });
    });
  });
});
