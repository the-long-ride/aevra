import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import type { WorkspaceSummary } from '@aevra/admin-contracts';
import { DialogProvider } from '../../components/Dialog';
import type { installApiFixtures } from '../../test/api-fixtures';
import { ConnectionDetailModal, type ActiveConnection } from './ConnectionDetailModal';

export const workspaces: WorkspaceSummary[] = [
  { id: 'ws-1', name: 'Aevra', hostRoot: '/repo' },
  { id: 'ws-2', name: 'Docs', hostRoot: '/docs' },
];

const connection: ActiveConnection = {
  id: 'ses-chatgpt',
  client: 'ChatGPT',
  actor: 'oauth:ChatGPT',
  provider: 'OAuth',
  authType: 'OAuth',
  yolo: true,
  workspace: 'Aevra',
  workspaces: ['Aevra'],
  workspaceIds: ['ws-1'],
  capabilities: ['files.read'],
  status: 'active',
};

export function mutationCall(
  fetchMock: ReturnType<typeof installApiFixtures>,
  path: string,
  method: string,
) {
  return fetchMock.mock.calls.find(([input, init]) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.pathname + input.search
          : input.url;
    return url === path && String(init?.method ?? 'GET').toUpperCase() === method;
  });
}

export function renderModal(overrides: Partial<ActiveConnection> = {}) {
  const onClose = vi.fn();
  const onChanged = vi.fn(async () => undefined);
  render(
    <DialogProvider>
      <ConnectionDetailModal
        connection={{ ...connection, ...overrides }}
        workspaces={workspaces}
        onClose={onClose}
        onChanged={onChanged}
      />
    </DialogProvider>,
  );
  return { onClose, onChanged };
}

export function grantControls() {
  const trigger = screen.getByRole('button', { name: 'Grant workspace' });
  const confirm = screen.getByRole('button', { name: '[+]' });
  return { trigger, confirm };
}
