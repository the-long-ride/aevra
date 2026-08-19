import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { installApiFixtures } from '../test/api-fixtures';
import { AuditPage } from './audit/AuditPage';
import { ChangesPage } from './changes/ChangesPage';
import { PermissionsPage } from './permissions/PermissionsPage';
import { ProcessesPage } from './processes/ProcessesPage';
import { SessionsPage } from './sessions/SessionsPage';
import { WorkspacesPage } from './workspaces/WorkspacesPage';

function mutationCall(
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

test('Permissions creates normalized command rules and revokes remembered rules', async () => {
  const user = userEvent.setup();
  const fetchMock = installApiFixtures({
    routes: {
      '/api/permissions': [
        {
          id: 'rule-1',
          effect: 'allow',
          capability: 'files.read',
          scope: 'workspace',
          actor: 'connector:ChatGPT',
          matcher: '*',
        },
      ],
    },
  });
  render(<PermissionsPage />);

  expect(await screen.findByRole('heading', { name: 'Permissions' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Add rules' }));
  await user.type(screen.getByLabelText('Connector actors'), 'connector:Claude');
  await user.type(screen.getByLabelText('Workspace IDs'), 'ws-1');
  await user.click(screen.getByRole('checkbox', { name: 'commands.run' }));
  await waitFor(() =>
    expect(document.querySelector<HTMLTextAreaElement>('textarea[name="commandMatchers"]')).not.toBeNull(),
  );
  const matchers = document.querySelector<HTMLTextAreaElement>('textarea[name="commandMatchers"]');
  expect(matchers).not.toBeNull();
  fireEvent.change(matchers!, { target: { value: 'git:status\nnpm:test' } });
  await user.click(screen.getByRole('button', { name: 'Create rules' }));

  await waitFor(() =>
    expect(mutationCall(fetchMock, '/api/permissions/bulk', 'POST')).toBeTruthy(),
  );
  const create = mutationCall(fetchMock, '/api/permissions/bulk', 'POST');
  expect(JSON.parse(String(create?.[1]?.body))).toMatchObject({
    actors: ['connector:Claude'],
    workspaceIds: ['ws-1'],
    commandMatchers: ['git:status', 'npm:test'],
  });

  await user.click(await screen.findByRole('button', { name: 'Revoke' }));
  await waitFor(() =>
    expect(mutationCall(fetchMock, '/api/permissions/rule-1', 'DELETE')).toBeTruthy(),
  );
});

test('Workspaces adds and removes mounts, saves admission, and can register another root', async () => {
  const user = userEvent.setup();
  const fetchMock = installApiFixtures({
    routes: {
      '/api/workspaces/ws-1/mounts': [
        {
          id: 'mount-1',
          logicalPath: '/external/shared',
          hostRoot: '/opt/shared',
          capabilities: ['files.read', 'files.search'],
        },
      ],
    },
  });
  render(<WorkspacesPage />);

  expect(await screen.findByRole('heading', { name: 'Workspaces' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Details' }));
  expect(await screen.findByText('/external/shared')).toBeInTheDocument();

  const removeMount = document.querySelector<HTMLButtonElement>(
    '[data-surface-id="workspaces:remove-mount"]',
  );
  expect(removeMount).not.toBeNull();
  await user.click(removeMount!);
  await waitFor(() =>
    expect(mutationCall(fetchMock, '/api/mounts/mount-1', 'DELETE')).toBeTruthy(),
  );

  const addMountButton = screen.getByRole('button', { name: 'Add mount' });
  const mountForm = addMountButton.closest('form');
  expect(mountForm).not.toBeNull();
  const mount = within(mountForm!);
  await user.type(mount.getByLabelText('Logical path'), '/external/new');
  await user.type(mount.getByLabelText('Local mount root'), '/opt/new');
  await user.click(addMountButton);
  await waitFor(() =>
    expect(mutationCall(fetchMock, '/api/workspaces/ws-1/mounts', 'POST')).toBeTruthy(),
  );

  const saveAdmissionButton = screen.getByRole('button', { name: 'Save admission' });
  const admissionFormElement = saveAdmissionButton.closest('form');
  expect(admissionFormElement).not.toBeNull();
  const admissionForm = within(admissionFormElement!);
  await user.type(admissionForm.getByLabelText('Actor'), 'connector:Claude');
  await user.selectOptions(admissionForm.getByLabelText('Profile'), 'full-workspace');
  await user.selectOptions(admissionForm.getByLabelText('Admission'), 'ask');
  await user.click(saveAdmissionButton);
  await waitFor(() =>
    expect(mutationCall(fetchMock, '/api/workspaces/ws-1/admission', 'POST')).toBeTruthy(),
  );

  vi.mocked(window.prompt)
    .mockReturnValueOnce('Extra')
    .mockReturnValueOnce('/repo/extra');
  await user.click(screen.getByRole('button', { name: 'Add workspace' }));
  await waitFor(() =>
    expect(mutationCall(fetchMock, '/api/workspaces', 'POST')).toBeTruthy(),
  );
  const registration = mutationCall(fetchMock, '/api/workspaces', 'POST');
  expect(JSON.parse(String(registration?.[1]?.body))).toEqual({
    name: 'Extra',
    hostRoot: '/repo/extra',
  });
});

test('Sessions switches workspace and revokes remote, local, and other sessions', async () => {
  const user = userEvent.setup();
  const fetchMock = installApiFixtures({
    routes: {
      '/api/sessions': [
        {
          id: 'session-1',
          actor: 'ChatGPT',
          activeLeaseId: 'lease-1',
          lease: { workspaceId: 'ws-1' },
          state: 'ACTIVE',
        },
      ],
      '/api/admin-sessions': [{ idHash: 'admin-1', createdAt: '2026-08-19T00:00:00Z' }],
    },
  });
  render(<SessionsPage />);

  expect(await screen.findByRole('heading', { name: 'Sessions' })).toBeInTheDocument();
  vi.mocked(window.prompt).mockReturnValueOnce('ws-1');
  await user.click(screen.getByRole('button', { name: 'Switch' }));
  await waitFor(() =>
    expect(mutationCall(fetchMock, '/api/sessions/session-1/workspace', 'POST')).toBeTruthy(),
  );

  const remoteTable = document.querySelector<HTMLElement>('[data-table-id="react-remote-sessions"]');
  expect(remoteTable).not.toBeNull();
  await user.click(within(remoteTable!).getByRole('button', { name: 'Revoke' }));
  await waitFor(() =>
    expect(mutationCall(fetchMock, '/api/sessions/session-1/revoke', 'POST')).toBeTruthy(),
  );

  const localTable = document.querySelector<HTMLElement>('[data-table-id="react-local-sessions"]');
  expect(localTable).not.toBeNull();
  await user.click(within(localTable!).getByRole('button', { name: 'Revoke' }));
  await waitFor(() =>
    expect(mutationCall(fetchMock, '/api/admin-sessions/admin-1/revoke', 'POST')).toBeTruthy(),
  );

  await user.click(screen.getByRole('button', { name: 'Revoke all others' }));
  await waitFor(() =>
    expect(mutationCall(fetchMock, '/api/sessions/revoke-others', 'POST')).toBeTruthy(),
  );
});

test('Processes exposes stop restart and forget mutations', async () => {
  const user = userEvent.setup();
  const fetchMock = installApiFixtures({
    routes: {
      '/api/processes': [
        { id: 'process-1', command: 'npm test', state: 'running', workspaceId: 'ws-1' },
      ],
    },
  });
  render(<ProcessesPage />);

  expect(await screen.findByRole('heading', { name: 'Processes' })).toBeInTheDocument();
  for (const [label, action] of [
    ['Stop', 'stop'],
    ['Restart', 'restart'],
    ['Forget', 'forget'],
  ] as const) {
    await user.click(screen.getByRole('button', { name: label }));
    await waitFor(() =>
      expect(mutationCall(fetchMock, `/api/processes/process-1/${action}`, 'POST')).toBeTruthy(),
    );
  }
});

test('Changes renames, keeps, and rolls back an open change set', async () => {
  const user = userEvent.setup();
  const fetchMock = installApiFixtures({
    routes: {
      '/api/changes': [{ id: 'change-1', name: 'Work', state: 'OPEN', workspace_id: 'ws-1' }],
    },
  });
  render(<ChangesPage />);

  expect(await screen.findByRole('heading', { name: 'Changes' })).toBeInTheDocument();
  vi.mocked(window.prompt).mockReturnValueOnce('Renamed work');
  await user.click(screen.getByRole('button', { name: 'Rename' }));
  await waitFor(() =>
    expect(mutationCall(fetchMock, '/api/changes/change-1', 'PATCH')).toBeTruthy(),
  );
  const rename = mutationCall(fetchMock, '/api/changes/change-1', 'PATCH');
  expect(JSON.parse(String(rename?.[1]?.body))).toEqual({ name: 'Renamed work' });

  await user.click(screen.getByRole('button', { name: 'Keep' }));
  await waitFor(() =>
    expect(mutationCall(fetchMock, '/api/changes/change-1/commit', 'POST')).toBeTruthy(),
  );

  await user.click(screen.getByRole('button', { name: 'Rollback' }));
  await waitFor(() =>
    expect(mutationCall(fetchMock, '/api/changes/change-1/rollback', 'POST')).toBeTruthy(),
  );
});

test('Audit renders exported events and clears history only through the mutation endpoint', async () => {
  const user = userEvent.setup();
  const fetchMock = installApiFixtures({
    routes: {
      '/api/audit/export?format=json': [
        {
          createdAt: '2026-08-19T00:00:00Z',
          event: {
            actor: 'ChatGPT',
            operation: 'workspace.select',
            target: 'ws-1',
            result: 'ok',
          },
        },
      ],
    },
  });
  render(<AuditPage />);

  expect(await screen.findByRole('heading', { name: 'Audit' })).toBeInTheDocument();
  expect(await screen.findByText('workspace.select')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Clear history' }));
  await waitFor(() => expect(mutationCall(fetchMock, '/api/audit', 'DELETE')).toBeTruthy());
});
