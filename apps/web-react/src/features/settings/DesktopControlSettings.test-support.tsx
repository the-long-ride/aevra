import { render } from '@testing-library/react';
import { vi } from 'vitest';
import { DialogProvider } from '../../components/Dialog';
import { requestJson } from '../../services/api-client';
import {
  DesktopControlSettings,
  type AppCatalogRow,
  type DesktopPolicySnapshot,
  type DetectedApp,
} from './DesktopControlSettings';

export const policy: DesktopPolicySnapshot = {
  mode: 'denylist',
  applications: [],
  unattributedInput: 'deny',
};

export const apps: DetectedApp[] = [
  {
    displayName: 'Notepad Replacement',
    version: '2.3.1',
    executablePath: 'C:\\Program Files\\NotepadReplacement\\np.exe',
    exeBasename: 'np.exe',
  },
];

export const requestJsonMock = vi.mocked(requestJson);
let catalogRows: AppCatalogRow[] = [];
let grantRows: Array<{
  id: string;
  executablePath: string;
  displayName: string;
  createdAt: string;
}> = [];
let customIdSequence = 0;
let grantIdSequence = 0;

export function resetDesktopControlTestState() {
  catalogRows = [];
  grantRows = [];
  customIdSequence = 0;
  grantIdSequence = 0;
}

export function customApp(overrides: Partial<AppCatalogRow> = {}): AppCatalogRow {
  return {
    displayName: 'Old Tool',
    version: '1.0.0',
    executablePath: 'C:\\Tools\\OldTool.exe',
    exeBasename: 'OldTool.exe',
    sources: ['custom'],
    grantable: true,
    isCustom: true,
    customAppId: 'custom-old-tool',
    ...overrides,
  };
}

export function mount(
  overrides: Partial<DesktopPolicySnapshot> = {},
  initialApps: AppCatalogRow[] = apps,
) {
  const value = { ...policy, ...overrides };
  const save = vi.fn().mockImplementation(async (next) => ({ ...value, ...next }));
  catalogRows = initialApps.map((app) => ({ ...app }));
  grantRows = [];
  render(
    <DialogProvider>
      <DesktopControlSettings
        load={() => Promise.resolve(value)}
        save={save}
        loadApps={() => Promise.resolve(catalogRows)}
      />
    </DialogProvider>,
  );
  return { save };
}

export function configureDesktopApiMock() {
  requestJsonMock.mockReset();
  requestJsonMock.mockImplementation(async <T,>(path: string, init: RequestInit = {}) => {
    if (path === '/api/desktop/app-grants' && init.method === 'POST') {
      const input = JSON.parse(String(init.body)) as {
        executablePath: string;
        displayName: string;
      };
      const grant = {
        id: `grant-${++grantIdSequence}`,
        ...input,
        createdAt: '2026-09-23T00:00:00.000Z',
      };
      grantRows = [...grantRows, grant];
      catalogRows = catalogRows.map((app) =>
        app.executablePath?.toLowerCase() === input.executablePath.toLowerCase()
          ? { ...app, isGranted: true, grantId: grant.id }
          : app,
      );
      return { grant } as T;
    }
    if (path === '/api/desktop/app-grants') return { grants: grantRows } as T;
    if (path.startsWith('/api/desktop/app-grants/')) {
      const id = decodeURIComponent(path.split('/').at(-1) ?? '');
      grantRows = grantRows.filter((grant) => grant.id !== id);
      catalogRows = catalogRows.map((app) =>
        app.grantId === id ? { ...app, isGranted: false, grantId: undefined } : app,
      );
      return {} as T;
    }
    if (path === '/api/desktop/custom-apps' && init.method === 'PUT') {
      const input = JSON.parse(String(init.body)) as {
        id?: string;
        executablePath: string;
        displayName: string;
        version: string | null;
      };
      const id = input.id ?? `custom-${++customIdSequence}`;
      const exeBasename = input.executablePath.split(/[\\/]/).at(-1) ?? input.executablePath;
      const app: AppCatalogRow = {
        ...input,
        displayName: input.displayName || exeBasename.replace(/\.exe$/i, ''),
        exeBasename,
        sources: ['custom'],
        grantable: true,
        isCustom: true,
        isGranted: false,
        customAppId: id,
      };
      catalogRows = [
        ...catalogRows.filter(
          (row) =>
            row.customAppId !== id &&
            row.executablePath?.toLowerCase() !== input.executablePath.toLowerCase(),
        ),
        app,
      ];
      return { app } as T;
    }
    if (path.startsWith('/api/desktop/custom-apps/') && init.method === 'DELETE') {
      const id = decodeURIComponent(path.split('/').at(-1) ?? '');
      catalogRows = catalogRows.filter((app) => app.customAppId !== id);
      return { app: { id } } as T;
    }
    throw new Error(`Unexpected desktop API request: ${init.method ?? 'GET'} ${path}`);
  });
}
