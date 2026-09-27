import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DialogProvider } from '../../components/Dialog';
import { RequestDrawer } from './RequestDrawer';
import * as service from './requests-service';

vi.mock('./request-notifications', () => ({ announceNewRequests: vi.fn() }));
vi.mock('./requests-service', () => ({
  approveRequest: vi.fn(),
  decideOauth: vi.fn(),
  denyRequest: vi.fn(),
  decideDesktopAccessRequest: vi.fn(),
  enableYoloRequest: vi.fn(),
  loadDesktopAccessRequests: vi.fn(),
  loadRequests: vi.fn(),
}));

const svc = vi.mocked(service);

function approval(overrides: Record<string, unknown> = {}) {
  return {
    id: 'app-1',
    state: 'PENDING',
    actor: 'connector:cli',
    risk: 'LOW',
    workspaceId: 'ws-1',
    sessionId: 'session-1',
    operation: { family: 'git:diff', capability: 'commands.run' },
    payload: { original: { permissionMatcher: 'git:diff:--stat' } },
    ...overrides,
  } as any;
}

function desktop(overrides: Record<string, unknown> = {}) {
  return {
    id: 'dsk-1',
    actor: 'connector:desk',
    hostExecutablePath: 'C:\\Apps\\Host.exe',
    targetExecutablePath: 'C:\\Runtime\\MSEdgeWebView2.exe',
    requestedDuration: 'session',
    expiresAt: '2026-01-01T12:00:00.000Z',
    ...overrides,
  } as any;
}

function setData(parts: Record<string, unknown> = {}, desktopRequests: unknown[] = []) {
  svc.loadRequests.mockResolvedValue({
    approvals: [],
    oauth: [],
    workspaces: [{ id: 'ws-1', name: 'Main space' }],
    ...parts,
  } as any);
  svc.loadDesktopAccessRequests.mockResolvedValue(desktopRequests as any);
}

function renderDrawer() {
  const onPendingCountChange = vi.fn();
  const view = render(
    <DialogProvider>
      <RequestDrawer open onClose={vi.fn()} onPendingCountChange={onPendingCountChange} />
    </DialogProvider>,
  );
  return { ...view, onPendingCountChange };
}

beforeEach(() => {
  for (const fn of Object.values(svc)) (fn as any).mockReset?.();
  svc.approveRequest.mockResolvedValue(undefined as any);
  svc.denyRequest.mockResolvedValue(undefined as any);
  svc.enableYoloRequest.mockResolvedValue(undefined as any);
  svc.decideOauth.mockResolvedValue(undefined as any);
  svc.decideDesktopAccessRequest.mockResolvedValue(undefined as any);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('RequestDrawer branches', () => {
  it('renders fallback presentation with the saved matcher and workspace name', async () => {
    setData({ approvals: [approval()] });
    renderDrawer();
    const card = await waitFor(() => {
      const el = document.querySelector('[data-request-id="app-1"]');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(within(card).getByText('Saved matcher')).toBeInTheDocument();
    expect(within(card).getByText('git:diff:--stat')).toBeInTheDocument();
    expect(within(card).getByText('Main space')).toBeInTheDocument();
  });

  it('approves with a scope and denies without one, refreshing each time', async () => {
    setData({ approvals: [approval({ operation: { family: 'files:write', capability: 'files.write' } })] });
    renderDrawer();
    fireEvent.click(await screen.findByRole('button', { name: 'Allow' }));
    await waitFor(() => expect(svc.approveRequest).toHaveBeenCalledWith('app-1', 'once'));
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    await waitFor(() => expect(svc.denyRequest).toHaveBeenCalledWith('app-1'));
    await waitFor(() => expect(svc.loadRequests.mock.calls.length).toBeGreaterThanOrEqual(3));
  });

  it('enables YOLO only after confirmation', async () => {
    setData({ approvals: [approval()] });
    renderDrawer();
    fireEvent.click(await screen.findByRole('button', { name: 'Enable YOLO' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByText('Enable YOLO session?')).not.toBeInTheDocument());
    expect(svc.enableYoloRequest).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Enable YOLO' }));
    const title = await screen.findByText('Enable YOLO session?');
    const dialog = title.closest('[role="dialog"], [role="alertdialog"]') as HTMLElement;
    fireEvent.click(within(dialog).getByRole('button', { name: 'Enable YOLO' }));
    await waitFor(() => expect(svc.enableYoloRequest).toHaveBeenCalledWith('app-1'));
  });

  it('labels a WebView2 target as a verified host app', async () => {
    setData({}, [desktop()]);
    renderDrawer();
    expect(await screen.findByText(/Verified host app/)).toHaveTextContent('C:\\Apps\\Host.exe');
    expect(screen.getByText(/WebView2 process:/)).toBeInTheDocument();
  });

  it('labels a plain executable as an application and records each decision', async () => {
    setData({}, [desktop({ targetExecutablePath: 'C:\\Apps\\Tool.exe' })]);
    renderDrawer();
    expect(await screen.findByText(/Application/)).toBeInTheDocument();
    expect(screen.queryByText(/WebView2 process:/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Allow this session' }));
    await waitFor(() =>
      expect(svc.decideDesktopAccessRequest).toHaveBeenCalledWith('dsk-1', 'session'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Persist for this app' }));
    await waitFor(() =>
      expect(svc.decideDesktopAccessRequest).toHaveBeenCalledWith('dsk-1', 'persistent'),
    );
  });

  it('shows desktop decision failures for Error and non-Error rejections', async () => {
    setData({}, [desktop()]);
    renderDrawer();
    svc.decideDesktopAccessRequest.mockRejectedValueOnce(new Error('grant store offline'));
    fireEvent.click(await screen.findByRole('button', { name: 'Deny' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('grant store offline');
    svc.decideDesktopAccessRequest.mockRejectedValueOnce('plain refusal');
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('plain refusal'));
  });

  it('stringifies a non-Error desktop list failure', async () => {
    setData();
    svc.loadDesktopAccessRequests.mockRejectedValue('desktop list unavailable');
    renderDrawer();
    expect(await screen.findByRole('alert')).toHaveTextContent('desktop list unavailable');
    expect(screen.getByText('No pending requests')).toBeInTheDocument();
  });

  it('decides OAuth requests with client id and remote fallbacks', async () => {
    setData({ oauth: [{ id: 'oa-1', clientId: 'client-one', pairingCode: '4321' }] });
    renderDrawer();
    expect(await screen.findByText('client-one')).toBeInTheDocument();
    expect(screen.getByText(/Remote client/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
    await waitFor(() => expect(svc.decideOauth).toHaveBeenCalledWith('oa-1', true));
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    await waitFor(() => expect(svc.decideOauth).toHaveBeenCalledWith('oa-1', false));
  });

  it('requests browser notification permission and reflects the result', async () => {
    const requestPermission = vi.fn().mockResolvedValue('granted');
    vi.stubGlobal('Notification', { permission: 'default', requestPermission });
    setData();
    renderDrawer();
    fireEvent.click(await screen.findByRole('button', { name: 'Enable browser notifications' }));
    expect(
      await screen.findByRole('button', { name: 'Browser notifications enabled' }),
    ).toBeDisabled();
    expect(requestPermission).toHaveBeenCalledTimes(1);
  });

  it('shows blocked notifications as disabled', async () => {
    vi.stubGlobal('Notification', { permission: 'denied', requestPermission: vi.fn() });
    setData();
    renderDrawer();
    expect(
      await screen.findByRole('button', { name: 'Browser notifications blocked' }),
    ).toBeDisabled();
  });

  it('lists resolved approvals by operation family in history', async () => {
    setData({
      approvals: [
        approval({ id: 'old-1', state: 'APPROVED', operation: { family: 'files:read', capability: 'files.read' } }),
      ],
    });
    renderDrawer();
    fireEvent.click(await screen.findByRole('button', { name: 'History' }));
    expect(await screen.findByText('files:read')).toBeInTheDocument();
  });
});
