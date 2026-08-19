import { render, screen, waitFor, within } from '@testing-library/react';
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

  expect(
    await screen.findByRole('heading', { name: 'Permissions' }),
  ).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Add rules' }));
  await user.type(screen.getByLabelText('Connector actors'), 'connector:Claude');
  await user.type(screen.getByLabelText('Workspace IDs'), 'ws-1');
  await user.click(screen.getByLabelText('commands.run'));
  await user.type(screen.getByLabelText('Command matchers'), 'git:status\nnpm:test');
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

  expect(
    await screen.findByRole('heading', { name: 'Workspaces' }),
  ).toBeInTheDocument();
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

  await user.type(screen.getByLabelText('Logical path'), '/external/sdk');
  await user.type(screen.getByLabelText('Local mount root'), '/opt/sdk');
  await user.click(screen.getByRole('button', { name: 'Add mount' }));
  await waitFor(() =>
    expect(
      mutationCall(fetchMock, '/api/workspaces/ws-1/mounts', 'POST'),
    ).toBeTruthy(),
  );

  await user.type(screen.getByLabelText('Actor'), 'connector:ChatGPT');
  await user.click(screen.getByRole('button', { name: 'Save admission' }));
  await waitFor(() =>
    expect(
      mutationCall(fetchMock, '/api/workspaces/ws-1/admission', 'POST'),
    ).toBeTruthy(),
  );

  vi.stubGlobal(
    'prompt',
    vi
      .fn()
      .mockReturnValueOnce('Second workspace')
      .mockReturnValueOnce('/projects/second'),
  );
  await user.click(screen.getByRole('button', { name: 'Add workspace' }));
  await waitFor(() =>
    expect(mutationCall(fetchMock, '/api/workspaces', 'POST')).toBeTruthy(),
  );
});

test('Sessions switches workspace and revokes remote, local, and other sessions', async () => {
  const user = userEvent.setup();
  const fetchMock = installApiFixtures({
    routes: {
      '/api/sessions': [
        {
          id: 'remote-1',
          actor: 'ChatGPT',
          activeLeaseId: 'lease-1',
          lease: { workspaceId: 'ws-1' },
        },
      ],
      '/api/admin-sessions': [{ idHash: 'local-1' }],
    },
  });
  vi.stubGlobal('prompt', vi.fn(() => 'ws-1'));
  render(<SessionsPage />);

  expect(await screen.findByRole('heading', { name: 'Sessions' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Switch' }));
  await waitFor(() =>
    expect(
      mutationCall(fetchMock, '/api/sessions/remote-1/workspace', 'POST'),
    ).toBeTruthy(),
  );

  const remoteRevoke = document.querySelector<HTMLButtonElement>(
    '[data-surface-id="sessions:revoke"]',
  );
  expect(remoteRevoke).not.toBeNull();
  await user.click(remoteRevoke!);
  await waitFor(() =>
    expect(
      mutationCall(fetchMock, '/api/sessions/remote-1/revoke', 'POST'),
    ).toBeTruthy(),
  );

  const localPanel = screen
    .getByRole('heading', { name: 'Local admin sessions' })
    .closest('section');
  expect(localPanel).not.toBeNull();
  await user.click(within(localPanel!).getByRole('button', { name: 'Revoke' }));
  await waitFor(() =>
    expect(
      mutationCall(fetchMock, '/api/admin-sessions/local-1/revoke', 'POST'),
    ).toBeTruthy(),
  );

  await user.click(screen.getByRole('button', { name: 'Revoke all others' }));
  await waitFor(() =>
    expect(
      mutationCall(fetchMock, '/api/sessions/revoke-others', 'POST'),
    ).toBeTruthy(),
  );
});

test('Processes exposes stop restart and forget mutations', async () => {
  const user = userEvent.setup();
  const fetchMock = installApiFixtures({
    routes: {
      '/api/processes': [
        {
          id: 'proc-1',
          workspace_id: 'ws-1',
          ownership: 'owned',
          lifecycle: 'running',
        },
      ],
    },
  });
  render(<ProcessesPage />);

  expect(
    await screen.findByRole('heading', { name: 'Processes' }),
  ).toBeInTheDocument();
  for (const [label, action] of [
    ['Stop', 'stop'],
    ['Restart', 'restart'],
    ['Forget', 'forget'],
  ] as const) {
    await user.click(await screen.findByRole('button', { name: label }));
    await waitFor(() =>
      expect(
        mutationCall(fetchMock, `/api/processes/proc-1/${action}`, 'POST'),
      ).toBeTruthy(),
    );
  }
});

test('Changes renames, keeps, and rolls back an open change set', async () => {
  const user = userEvent.setup();
  const fetchMock = installApiFixtures({
    routes: {
      '/api/changes': [
        { id: 'change-1', name: 'Draft', state: 'OPEN', workspace_id: 'ws-1' },
      ],
    },
  });
  vi.stubGlobal('prompt', vi.fn(() => 'Renamed'));
  render(<ChangesPage />);

  expect(await screen.findByRole('heading', { name: 'Changes' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Rename' }));
  await waitFor(() =>
    expect(mutationCall(fetchMock, '/api/changes/change-1', 'PATCH')).toBeTruthy(),
  );

  await user.click(await screen.findByRole('button', { name: 'Keep' }));
  await waitFor(() =>
    expect(
      mutationCall(fetchMock, '/api/changes/change-1/commit', 'POST'),
    ).toBeTruthy(),
  );

  await user.click(await screen.findByRole('button', { name: 'Rollback' }));
  await waitFor(() =>
    expect(
      mutationCall(fetchMock, '/api/changes/change-1/rollback', 'POST'),
    ).toBeTruthy(),
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
            operation: 'commands.run',
            target: 'git status',
            result: 'ok',
          },
        },
      ],
    },
  });
  render(<AuditPage />);

  expect(await screen.findByRole('heading', { name: 'Audit' })).toBeInTheDocument();
  expect(screen.getByText('commands.run')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Clear history' }));
  await waitFor(() =>
    expect(mutationCall(fetchMock, '/api/audit', 'DELETE')).toBeTruthy(),
  );
});
