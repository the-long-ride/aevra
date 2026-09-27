import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DialogProvider } from '../../components/Dialog';
import { requestJson } from '../../services/api-client';
import { RequestApprovalModal } from './RequestApprovalModal';
import type { RequestsData } from './requests-service';

vi.mock('../../services/api-client', () => ({ requestJson: vi.fn() }));

const mockedRequest = vi.mocked(requestJson);

function approval(overrides: Record<string, unknown> = {}) {
  return {
    id: 'app-1',
    state: 'PENDING',
    actor: 'connector:cli',
    risk: 'LOW',
    workspaceId: 'ws-1',
    sessionId: 'session-1',
    operation: { family: 'files:write', capability: 'files.write' },
    ...overrides,
  } as any;
}

function oauth(overrides: Record<string, unknown> = {}) {
  return { id: 'oauth-1', clientId: 'client-one', pairingCode: '1234', ...overrides } as any;
}

function data(parts: Partial<RequestsData>): RequestsData {
  return { approvals: [], oauth: [], workspaces: [], ...parts };
}

function renderModal(value: RequestsData, onActioned = vi.fn().mockResolvedValue(undefined)) {
  const onDismiss = vi.fn();
  const view = render(
    <DialogProvider>
      <RequestApprovalModal data={value} onActioned={onActioned} onDismiss={onDismiss} />
    </DialogProvider>,
  );
  return { ...view, onActioned, onDismiss };
}

afterEach(() => {
  mockedRequest.mockReset();
});

describe('RequestApprovalModal branches', () => {
  it('omits the saved matcher when a command request has no family or matcher', () => {
    renderModal(
      data({
        approvals: [approval({ operation: { capability: 'commands.run' }, payload: {} })],
      }),
    );
    expect(screen.queryByText('Saved matcher')).not.toBeInTheDocument();
  });

  it('reports a generic message when an approval decision rejects with a non-Error', async () => {
    mockedRequest.mockRejectedValueOnce('boom');
    const { onActioned } = renderModal(data({ approvals: [approval()] }));
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The decision could not be recorded.',
    );
    expect(onActioned).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Deny' })).not.toBeDisabled();
  });

  it('shows an OAuth failure and lets the operator retry', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('server unavailable'));
    const { onActioned } = renderModal(data({ oauth: [oauth()] }));
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('server unavailable');
    expect(onActioned).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Allow' })).not.toBeDisabled();
  });

  it('shows the generic OAuth message for a non-Error rejection', async () => {
    mockedRequest.mockRejectedValueOnce(42);
    renderModal(data({ oauth: [oauth()] }));
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The decision could not be recorded.',
    );
  });

  it('refreshes instead of erroring when the OAuth request is already resolved', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('request already decided'));
    const { onActioned } = renderModal(data({ oauth: [oauth()] }));
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    await waitFor(() => expect(onActioned).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('switches to the OAuth card when the shown approval is replaced by an OAuth request', async () => {
    const onActioned = vi.fn().mockResolvedValue(undefined);
    const onDismiss = vi.fn();
    const { rerender } = render(
      <DialogProvider>
        <RequestApprovalModal
          data={data({ approvals: [approval()] })}
          onActioned={onActioned}
          onDismiss={onDismiss}
        />
      </DialogProvider>,
    );
    expect(document.querySelector('.approval-modal-head b')).toHaveTextContent('files:write');
    rerender(
      <DialogProvider>
        <RequestApprovalModal
          data={data({ oauth: [oauth({ clientName: 'Desk client', remoteIp: '10.0.0.9' })] })}
          onActioned={onActioned}
          onDismiss={onDismiss}
        />
      </DialogProvider>,
    );
    expect(await screen.findByText('OAuth connection')).toBeInTheDocument();
    expect(screen.getByText('Desk client')).toBeInTheDocument();
    expect(screen.getByText(/10\.0\.0\.9/)).toBeInTheDocument();
  });

  it('counts pending OAuth and approval requests together in the label', () => {
    renderModal(data({ oauth: [oauth()], approvals: [approval()] }));
    expect(screen.getByText(/Approval request.*2 pending/)).toBeInTheDocument();
  });
});
