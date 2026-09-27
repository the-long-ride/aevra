import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DialogProvider } from '../../components/Dialog';
import { requestJson } from '../../services/api-client';
import {
  CUSTOM_APPS_STORAGE_KEY,
  DesktopControlSettings,
  type AppCatalogRow,
  type DesktopAppsLoadResult,
  type DesktopPolicySnapshot,
} from './DesktopControlSettings';

vi.mock('../../services/api-client', () => ({ requestJson: vi.fn() }));

const requestJsonMock = vi.mocked(requestJson);
type Handler = (path: string, init: RequestInit) => unknown;
let handler: Handler;
let grants: Array<Record<string, unknown>> = [];

const basePolicy: DesktopPolicySnapshot = {
  mode: 'allowlist',
  applications: [],
  unattributedInput: 'deny',
};

function row(overrides: Partial<AppCatalogRow> = {}): AppCatalogRow {
  return {
    displayName: 'Paint Tool',
    version: '1.0',
    executablePath: 'C:\\Apps\\paint.exe',
    exeBasename: 'paint.exe',
    sources: ['registry'],
    grantable: true,
    ...overrides,
  };
}

function renderSettings({
  policy = basePolicy,
  load,
  save,
  loadApps,
}: {
  policy?: DesktopPolicySnapshot;
  load?: () => Promise<DesktopPolicySnapshot>;
  save?: (next: Partial<DesktopPolicySnapshot>) => Promise<DesktopPolicySnapshot>;
  loadApps?: () => Promise<DesktopAppsLoadResult>;
} = {}) {
  const saveFn = vi.fn(save ?? (async (next) => ({ ...policy, ...next })));
  const view = render(
    <DialogProvider>
      <DesktopControlSettings
        load={load ?? (() => Promise.resolve(policy))}
        save={saveFn}
        loadApps={loadApps ?? (() => Promise.resolve([row()]))}
      />
    </DialogProvider>,
  );
  return { save: saveFn, ...view };
}

beforeEach(() => {
  window.localStorage.clear();
  grants = [];
  handler = (path) => {
    if (path === '/api/desktop/app-grants') return { grants };
    return {};
  };
  requestJsonMock.mockReset();
  requestJsonMock.mockImplementation(async (path: string, init: RequestInit = {}) =>
    handler(path, init),
  );
});

afterEach(() => {
  vi.useRealTimers();
  window.localStorage.clear();
});

describe('DesktopControlSettings catalog loading', () => {
  it('shows partial discovery warnings from an object catalog response', async () => {
    renderSettings({
      loadApps: () => Promise.resolve({ apps: [row()], warnings: ['registry', 'start menu'] }),
    });
    expect(
      await screen.findByText('App discovery is partial: registry; start menu'),
    ).toBeInTheDocument();
  });

  it('treats an object response without warnings as complete discovery', async () => {
    renderSettings({ loadApps: () => Promise.resolve({ apps: [row()] }) });
    expect(await screen.findByText('Paint Tool')).toBeInTheDocument();
    expect(screen.queryByText(/App discovery is partial/)).toBeNull();
  });

  it('reports unreadable sources when the catalog request fails', async () => {
    renderSettings({ loadApps: () => Promise.reject(new Error('offline')) });
    expect(
      await screen.findByText('App discovery is partial: Some app sources could not be read.'),
    ).toBeInTheDocument();
  });

  it('hides the grant list when grants cannot be loaded', async () => {
    handler = (path) => {
      if (path === '/api/desktop/app-grants') throw new Error('grants unavailable');
      return {};
    };
    renderSettings();
    expect(await screen.findByText('Paint Tool')).toBeInTheDocument();
    expect(screen.queryByText('Exact app grants')).toBeNull();
  });

  it('shows a non-Error initial load failure as text', async () => {
    renderSettings({ load: () => Promise.reject('policy store locked') });
    expect(await screen.findByRole('alert')).toHaveTextContent('policy store locked');
  });

  it('ignores load results that settle after unmount', async () => {
    let rejectLoad: (cause: unknown) => void = () => undefined;
    let rejectApps: (cause: unknown) => void = () => undefined;
    const { unmount } = renderSettings({
      load: () => new Promise((_, reject) => (rejectLoad = reject)),
      loadApps: () => new Promise((_, reject) => (rejectApps = reject)),
    });
    unmount();
    await act(async () => {
      rejectLoad(new Error('late'));
      rejectApps(new Error('late'));
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('ignores a successful load that settles after unmount', async () => {
    let resolveLoad: (value: DesktopPolicySnapshot) => void = () => undefined;
    const { unmount } = renderSettings({
      load: () => new Promise((resolve) => (resolveLoad = resolve)),
    });
    unmount();
    await act(async () => resolveLoad(basePolicy));
    expect(screen.queryByRole('region', { name: 'Desktop control' })).toBeNull();
  });
});

describe('DesktopControlSettings exact grants', () => {
  beforeEach(() => {
    grants = [
      {
        id: 'g-session',
        displayName: 'Session App',
        executablePath: 'C:\\A\\s.exe',
        createdAt: 'now',
        sessionId: 'sess',
      },
      {
        id: 'g-persist',
        displayName: 'Kept App',
        executablePath: 'C:\\A\\k.exe',
        createdAt: 'now',
      },
    ];
  });

  it('labels session and persistent grants and revokes one', async () => {
    renderSettings();
    expect(await screen.findByText(/This session · C:\\A\\s\.exe/)).toBeInTheDocument();
    expect(screen.getByText(/Persistent · C:\\A\\k\.exe/)).toBeInTheDocument();
    const list = screen.getByLabelText('Granted apps');
    fireEvent.click(within(list).getAllByRole('button', { name: 'Revoke' })[1]!);
    expect(await screen.findByText('// App grant revoked.')).toBeInTheDocument();
    expect(requestJsonMock).toHaveBeenCalledWith(
      '/api/desktop/app-grants/g-persist',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it.each([
    [new Error('revoke refused'), 'revoke refused'],
    ['revoke plain failure', 'revoke plain failure'],
  ])('shows revoke failures (%s)', async (cause, message) => {
    handler = (path, init) => {
      if (init.method === 'DELETE') throw cause;
      if (path === '/api/desktop/app-grants') return { grants };
      return {};
    };
    renderSettings();
    const list = await screen.findByLabelText('Granted apps');
    fireEvent.click(within(list).getAllByRole('button', { name: 'Revoke' })[0]!);
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
  });
});

describe('DesktopControlSettings toggles', () => {
  const webview = row({
    displayName: 'WebView2 Runtime',
    executablePath: 'C:\\Edge\\msedgewebview2.exe',
    exeBasename: 'msedgewebview2.exe',
    grantable: false,
    reason: 'shared-runtime',
  });

  it('enables broad WebView2 access after confirmation', async () => {
    const { save } = renderSettings({ loadApps: () => Promise.resolve([webview]) });
    fireEvent.click(await screen.findByRole('switch', { name: /WebView2 Runtime/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Allow WebView2 across apps?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Allow broad WebView2 access' }));
    expect(await screen.findByText('// Broad WebView2 access enabled.')).toBeInTheDocument();
    expect(save).toHaveBeenCalledWith({ applications: ['msedgewebview2.exe'] });
  });

  it('does nothing when broad WebView2 access is declined', async () => {
    const { save } = renderSettings({ loadApps: () => Promise.resolve([webview]) });
    fireEvent.click(await screen.findByRole('switch', { name: /WebView2 Runtime/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Allow WebView2 across apps?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(save).not.toHaveBeenCalled();
  });

  it('revokes the WebView2 grant and legacy rule when unchecked', async () => {
    const { save } = renderSettings({
      policy: { ...basePolicy, applications: ['MSEDGEWEBVIEW2.EXE', 'other.exe'] },
      loadApps: () => Promise.resolve([{ ...webview, grantId: 'wv-grant' }]),
    });
    fireEvent.click(await screen.findByRole('switch', { name: /WebView2 Runtime/ }));
    expect(await screen.findByText('// WebView2 access revoked.')).toBeInTheDocument();
    expect(save).toHaveBeenCalledWith({ applications: ['other.exe'] });
    expect(requestJsonMock).toHaveBeenCalledWith(
      '/api/desktop/app-grants/wv-grant',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('revokes an exact grant without saving when no legacy rule matches', async () => {
    const { save } = renderSettings({
      loadApps: () => Promise.resolve([row({ isGranted: true, grantId: 'paint-grant' })]),
    });
    fireEvent.click(await screen.findByRole('switch', { name: /Paint Tool/ }));
    expect(await screen.findByText('// App access revoked.')).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
  });

  it('also drops a matching legacy rule when unchecking a path row', async () => {
    const { save } = renderSettings({
      policy: { ...basePolicy, applications: ['Paint.exe'] },
    });
    fireEvent.click(await screen.findByRole('switch', { name: /Paint Tool/ }));
    expect(await screen.findByText('// App access revoked.')).toBeInTheDocument();
    expect(save).toHaveBeenCalledWith({ applications: [] });
    expect(requestJsonMock).not.toHaveBeenCalledWith(
      expect.stringMatching(/^\/api\/desktop\/app-grants\//),
      expect.anything(),
    );
  });

  it('adds a legacy rule for a catalog row without an executable path', async () => {
    const { save } = renderSettings({
      loadApps: () =>
        Promise.resolve([row({ executablePath: undefined, sources: undefined, version: null })]),
    });
    fireEvent.click(await screen.findByRole('switch', { name: /Paint Tool/ }));
    expect(await screen.findByText('// Desktop policy saved.')).toBeInTheDocument();
    expect(save).toHaveBeenCalledWith({ applications: ['paint.exe'] });
  });

  it.each([
    [new Error('grant refused'), 'grant refused'],
    ['grant plain failure', 'grant plain failure'],
  ])('shows grant failures (%s)', async (cause, message) => {
    handler = (path, init) => {
      if (init.method === 'POST') throw cause;
      if (path === '/api/desktop/app-grants') return { grants };
      return {};
    };
    renderSettings();
    fireEvent.click(await screen.findByRole('switch', { name: /Paint Tool/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
  });

  it('ignores a second change while another save is in flight', async () => {
    let finish: (value: DesktopPolicySnapshot) => void = () => undefined;
    const { save } = renderSettings({
      save: () => new Promise((resolve) => (finish = resolve)),
    });
    fireEvent.click(await screen.findByRole('switch', { name: /show file paths/i }));
    fireEvent.click(screen.getByRole('radio', { name: /allow all apps/i }));
    fireEvent.click(screen.getByRole('switch', { name: /Paint Tool/ }));
    expect(save).toHaveBeenCalledTimes(1);
    expect(requestJsonMock).not.toHaveBeenCalledWith('/api/desktop/app-grants', {
      method: 'POST',
      body: expect.any(String),
    });
    await act(async () => finish({ ...basePolicy, exposeExecutablePaths: true }));
    expect(await screen.findByText('// Desktop policy saved.')).toBeInTheDocument();
  });

  it('shows a non-Error save failure as text', async () => {
    renderSettings({ save: () => Promise.reject('disk full') });
    fireEvent.click(await screen.findByRole('switch', { name: /show file paths/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('disk full');
  });

  it('clears the success toast after three seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderSettings();
    fireEvent.click(await screen.findByRole('switch', { name: /show file paths/i }));
    expect(await screen.findByText('// Desktop policy saved.')).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.queryByText('// Desktop policy saved.')).toBeNull();
  });
});
