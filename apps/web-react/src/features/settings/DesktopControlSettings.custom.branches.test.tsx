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

describe('DesktopControlSettings custom apps', () => {
  it.each([
    [new Error('save rejected'), 'save rejected'],
    ['save plain failure', 'save plain failure'],
  ])('shows custom app save failures (%s)', async (cause, message) => {
    handler = (path, init) => {
      if (init.method === 'PUT') throw cause;
      if (path === '/api/desktop/app-grants') return { grants };
      return {};
    };
    renderSettings();
    fireEvent.click(await screen.findByRole('button', { name: /\+ add custom app with path/i }));
    fireEvent.change(screen.getByLabelText(/program file path/i), {
      target: { value: 'C:\\Tools\\fresh.exe' },
    });
    fireEvent.click(screen.getByRole('button', { name: /add application/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
  });

  it.each([
    [new Error('delete rejected'), 'delete rejected'],
    ['delete plain failure', 'delete plain failure'],
  ])('shows custom app delete failures (%s)', async (cause, message) => {
    handler = (path, init) => {
      if (init.method === 'DELETE') throw cause;
      if (path === '/api/desktop/app-grants') return { grants };
      return {};
    };
    renderSettings({
      loadApps: () => Promise.resolve([row({ isCustom: true, customAppId: 'c-1' })]),
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Paint Tool' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete custom app' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
  });

  it('skips the delete request for a custom row without an id', async () => {
    renderSettings({ loadApps: () => Promise.resolve([row({ isCustom: true })]) });
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Paint Tool' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete custom app' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(requestJsonMock).not.toHaveBeenCalledWith(
      expect.stringMatching(/custom-apps\//),
      expect.anything(),
    );
  });
});

describe('DesktopControlSettings browser-local migration', () => {
  const local = (name: string) => ({
    displayName: name,
    version: null,
    executablePath: `C:\\Local\\${name}.exe`,
    exeBasename: `${name}.exe`,
  });

  function echoPut(failing: string[] = []) {
    handler = (path, init) => {
      if (init.method === 'PUT') {
        const body = JSON.parse(String(init.body)) as { executablePath: string };
        if (failing.some((name) => body.executablePath.includes(name))) throw new Error('no');
        return { app: body };
      }
      if (path === '/api/desktop/app-grants') return { grants };
      return {};
    };
  }

  it('imports a single app and clears browser storage', async () => {
    window.localStorage.setItem(CUSTOM_APPS_STORAGE_KEY, JSON.stringify([local('one')]));
    echoPut();
    renderSettings({ policy: { ...basePolicy, mode: 'denylist' } });
    expect(await screen.findByText(/1 custom app are saved/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Import to Aevra' }));
    expect(await screen.findByText('// Imported 1 custom app.')).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem(CUSTOM_APPS_STORAGE_KEY)!)).toEqual([]);
    expect(screen.queryByRole('button', { name: 'Import to Aevra' })).toBeNull();
  });

  it('keeps a single failed app and reports it', async () => {
    window.localStorage.setItem(
      CUSTOM_APPS_STORAGE_KEY,
      JSON.stringify([local('one'), local('two'), local('three')]),
    );
    echoPut(['three']);
    renderSettings();
    expect(await screen.findByText(/3 custom apps are saved/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Import to Aevra' }));
    expect(await screen.findByText('// Imported 2 custom apps.')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/^1 app could not be imported/);
    expect(screen.getByText(/1 custom app are saved/)).toBeInTheDocument();
  });

  it('reports several failed apps with a plural message', async () => {
    window.localStorage.setItem(CUSTOM_APPS_STORAGE_KEY, JSON.stringify([local('a'), local('b')]));
    echoPut(['a', 'b']);
    renderSettings();
    fireEvent.click(await screen.findByRole('button', { name: 'Import to Aevra' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/^2 apps could not be imported/);
  });

  it.each([
    [new Error('catalog gone'), 'catalog gone'],
    ['catalog plain failure', 'catalog plain failure'],
  ])('surfaces a catalog refresh failure after import (%s)', async (cause, message) => {
    window.localStorage.setItem(CUSTOM_APPS_STORAGE_KEY, JSON.stringify([local('one')]));
    echoPut();
    let calls = 0;
    renderSettings({
      loadApps: () => (++calls === 1 ? Promise.resolve([row()]) : Promise.reject(cause)),
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Import to Aevra' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
  });
});
