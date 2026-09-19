import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DialogProvider } from '../../components/Dialog';
import { installApiFixtures } from '../../test/api-fixtures';
import { RequestApprovalModal } from './RequestApprovalModal';
import type { RequestsData } from './requests-service';

function renderWithDialog(ui: React.ReactElement) {
  return render(<DialogProvider>{ui}</DialogProvider>);
}

describe('RequestApprovalModal coverage', () => {
  it('returns null when no pending requests exist', () => {
    const data: RequestsData = {
      approvals: [{ id: '1', state: 'RESOLVED', actor: '', risk: 'LOW', operation: {} } as any],
      oauth: [],
      workspaces: [],
    };
    const { container } = renderWithDialog(
      <RequestApprovalModal data={data} onActioned={vi.fn()} onDismiss={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('handles item without presentation and savedMatcher fallback logic', () => {
    const data: RequestsData = {
      approvals: [
        {
          id: 'app-no-pres',
          state: 'PENDING',
          actor: 'bot',
          risk: 'HIGH',
          workspaceId: 'ws-unknown',
          sessionId: null,
          operation: { family: 'git:diff', capability: 'commands.run' },
          payload: {
            original: { permissionMatcher: 'git:diff:--cached' },
          },
        } as any,
      ],
      oauth: [],
      workspaces: [],
    };

    renderWithDialog(<RequestApprovalModal data={data} onActioned={vi.fn()} onDismiss={vi.fn()} />);

    expect(screen.getByText('git:diff:--cached')).toBeInTheDocument();
    expect(screen.getByText('ws-unknown')).toBeInTheDocument();
  });

  it('handles YOLO session enable confirmation and cancellation', async () => {
    const user = userEvent.setup();
    const fetchMock = installApiFixtures();
    const onActioned = vi.fn().mockResolvedValue(undefined);

    const data: RequestsData = {
      approvals: [
        {
          id: 'app-yolo',
          state: 'PENDING',
          actor: 'connector:cli',
          risk: 'HIGH',
          workspaceId: 'ws-1',
          sessionId: 'session-xyz',
          operation: { family: 'files:write', capability: 'files.write' },
        } as any,
      ],
      oauth: [],
      workspaces: [{ id: 'ws-1', name: 'My Workspace', hostRoot: '/repo' }],
    };

    renderWithDialog(
      <RequestApprovalModal data={data} onActioned={onActioned} onDismiss={vi.fn()} />,
    );

    const yoloBtn = screen.getByRole('button', { name: 'Enable YOLO' });
    expect(yoloBtn).toBeInTheDocument();

    // 1. Cancel confirmation
    await user.click(yoloBtn);
    const cancelBtn = screen.getByRole('button', { name: 'Cancel' });
    await user.click(cancelBtn);
    expect(onActioned).not.toHaveBeenCalled();

    // 2. Accept confirmation
    await user.click(yoloBtn);
    const dialog = screen.getByRole('dialog', { name: 'Enable YOLO session?' });
    const confirmBtn = within(dialog).getByRole('button', { name: 'Enable YOLO' });
    await user.click(confirmBtn);
    await waitFor(() => expect(onActioned).toHaveBeenCalled());
  });

  it('handles decision error states including terminal and non-terminal messages', async () => {
    const user = userEvent.setup();
    const onActioned = vi.fn().mockResolvedValue(undefined);

    // Non-terminal error
    installApiFixtures({
      mutationResponses: {
        'POST /api/approvals/app-fail/deny': new Response(
          JSON.stringify({ error: { message: 'Connection refused to agent' } }),
          { status: 500, headers: { 'content-type': 'application/json' } },
        ),
      },
    });

    const data: RequestsData = {
      approvals: [
        {
          id: 'app-fail',
          state: 'PENDING',
          actor: 'agent',
          risk: 'LOW',
          operation: { family: 'read', capability: 'files.read' },
        } as any,
      ],
      oauth: [],
      workspaces: [],
    };

    renderWithDialog(
      <RequestApprovalModal data={data} onActioned={onActioned} onDismiss={vi.fn()} />,
    );

    await user.click(screen.getByRole('button', { name: 'Deny' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Connection refused to agent');
    expect(onActioned).not.toHaveBeenCalled();

    // Terminal error: already expired -> should invoke onActioned to unblock UI
    installApiFixtures({
      mutationResponses: {
        'POST /api/approvals/app-fail/deny': new Response(
          JSON.stringify({ error: { message: 'cannot approve approved' } }),
          { status: 400, headers: { 'content-type': 'application/json' } },
        ),
      },
    });

    await user.click(screen.getByRole('button', { name: 'Deny' }));
    await waitFor(() => expect(onActioned).toHaveBeenCalled());
  });

  it('handles OAuth card interactions, deny, clientName fallback, and errors', async () => {
    const user = userEvent.setup();
    const onActioned = vi.fn().mockResolvedValue(undefined);

    installApiFixtures({
      mutationResponses: {
        'POST /api/oauth/requests/oauth-99/deny': { success: true },
      },
    });

    const data: RequestsData = {
      approvals: [],
      oauth: [
        {
          id: 'oauth-99',
          clientId: 'custom-client-id',
          pairingCode: '9999',
        } as any,
      ],
      workspaces: [],
    };

    renderWithDialog(
      <RequestApprovalModal data={data} onActioned={onActioned} onDismiss={vi.fn()} />,
    );

    // Fallback labels
    expect(screen.getByText('custom-client-id')).toBeInTheDocument();
    expect(screen.getByText(/Remote client/)).toBeInTheDocument();

    // Toggle keep signed in
    const toggle = screen.getByRole('switch');
    await user.click(toggle);
    expect(toggle).not.toBeChecked();

    // Deny button
    await user.click(screen.getByRole('button', { name: 'Deny' }));
    await waitFor(() => expect(onActioned).toHaveBeenCalled());
  });

  it('handles backdrop click and escape key to dismiss', async () => {
    const onDismiss = vi.fn();
    const data: RequestsData = {
      approvals: [
        {
          id: 'app-esc',
          state: 'PENDING',
          actor: 'agent',
          risk: 'LOW',
          operation: { family: 'read', capability: 'files.read' },
        } as any,
      ],
      oauth: [],
      workspaces: [],
    };

    const { container } = renderWithDialog(
      <RequestApprovalModal data={data} onActioned={vi.fn()} onDismiss={onDismiss} />,
    );

    // Escape key
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onDismiss).toHaveBeenCalledTimes(1);

    // Click backdrop
    const backdrop = container.querySelector('.approval-modal-backdrop')!;
    fireEvent.mouseDown(backdrop);
    expect(onDismiss).toHaveBeenCalledTimes(2);
  });

  it('handles regular approval deny action', async () => {
    const user = userEvent.setup();
    const onActioned = vi.fn().mockResolvedValue(undefined);
    installApiFixtures({
      mutationResponses: {
        'POST /api/approvals/app-deny/deny': { success: true },
      },
    });

    const data: RequestsData = {
      approvals: [
        {
          id: 'app-deny',
          state: 'PENDING',
          actor: 'agent',
          risk: 'LOW',
          operation: { family: 'read', capability: 'files.read' },
        } as any,
      ],
      oauth: [],
      workspaces: [],
    };

    renderWithDialog(
      <RequestApprovalModal data={data} onActioned={onActioned} onDismiss={vi.fn()} />,
    );

    const denyBtn = screen.getByRole('button', { name: 'Deny' });
    await user.click(denyBtn);
    await waitFor(() => expect(onActioned).toHaveBeenCalled());
  });

  it('traps and wraps tab focus correctly', async () => {
    const data: RequestsData = {
      approvals: [
        {
          id: 'app-focus',
          state: 'PENDING',
          actor: 'agent',
          risk: 'LOW',
          operation: { family: 'read', capability: 'files.read' },
        } as any,
      ],
      oauth: [],
      workspaces: [],
    };

    renderWithDialog(<RequestApprovalModal data={data} onActioned={vi.fn()} onDismiss={vi.fn()} />);

    const buttons = screen.getAllByRole('button');
    const firstButton = buttons[0];
    const lastButton = buttons[buttons.length - 1];

    // Focus first button, press Shift+Tab -> wraps to last button
    firstButton.focus();
    expect(document.activeElement).toBe(firstButton);
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(lastButton);

    // Focus last button, press Tab -> wraps to first button
    lastButton.focus();
    expect(document.activeElement).toBe(lastButton);
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: false });
    expect(document.activeElement).toBe(firstButton);

    // If active element is not in focusable list (index === -1), Tab focuses first button
    document.body.focus();
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: false });
    expect(document.activeElement).toBe(firstButton);

    // Non-tab key does nothing
    fireEvent.keyDown(window, { key: 'ArrowDown' });
  });
});
