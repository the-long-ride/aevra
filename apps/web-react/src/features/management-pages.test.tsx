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

  expect(await screen.findByRole('heading', { name: 'Permissions' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Add rules' }));
  await user.type(screen.getByLabelText('Connector actors'), 'connector:Claude');
  await user.type(screen.getByLabelText('Workspace IDs'), 'ws-1');
  await user.click(screen.getByLabelText('commands.run'));
  await user.type(await screen.findByLabelText('Command matchers'), 'git:status\nnpm:test');
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
    expect(mutationCall(fetchMock, '/api/workspaces/ws-1/mounts/mount-1', 'DELETE')).toBeTruthy(),
  );

  const mountForm = document.querySelector<HTMLFormElement>('.mount-form');
  expect(mountForm).not.toBeNull();
  const mount = within(mountForm!);
  await user.type(mount.getByLabelText('Logical path'), '/external/new');
  await user.type(mount.getByLabelText('Host root'), '/opt/new');
  await user.click(mount.getByRole('button', { name: 'Add mount' }));
  await waitFor(() =>
    expect(mutationCall(fetchMock, '/api/workspaces/ws-1/mounts', 'POST')).toBeTruthy(),
  );

  const admission = document.querySelector<HTMLFormElement>('.admission-form');
  expect(admission).not.toBeNull();
  const admissionForm = within(admission!);
  await user.selectOptions(admissionForm.getByLabelText('Profile cap'), 'coding');
  await user.click(admissionForm.getByRole('button', { name: 'Save admission' }));
  await waitFor(() =>
    expect(mutationCall(fetchMock, '/api/workspaces/ws-1/admission', 'PUT')).toBeTruthy(),
  );

  await user.click(screen.getByRole('button', { name: 'Register workspace' }));
  const register = document.querySelector<HTMLFormElement>('.workspace-register');
  expect(register).not.toBeNull();
  const registerForm = within(register!);
  await user.type(registerForm.getByLabelText('Name'), 'Extra');
  await user.type(registerForm.getByLabelText('Host root'), '/repo/extra');
  await user.click(registerForm.getByRole('button', { name: 'Register' }));
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
          id: 'session-1',
          actor: 'ChatGPT',
          workspaceId: 'ws-1',
          state: 'ACTIVE',
        },
      ],
      '/api/admin-sessions': [{ id: 'admin-1', createdAt: '2026-08-19T00:00:00Z' }],
    },
  });
  render(<SessionsPage />);

  expect(await screen.findByRole('heading', { name: 'Sessions' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Switch workspace' }));
  const switchForm = document.querySelector<HTMLFormElement>('.session-switch');
  expect(switchForm).not.toBeNull();
  const switchScope = within(switchForm!);
  await user.selectOptions(switchScope.getByLabelText('Workspace'), 'ws-1');
  await user.click(switchScope.getByRole('button', { name: 'Switch' }));
  await waitFor(() =>
    expect(mutationCall(fetchMock, '/api/sessions/session-1/workspace', 'POST')).toBeTruthy(),
  );

  await user.click(screen.getByRole('button', { name: 'Revoke remote' }));
  await waitFor(() =>
    expect(mutationCall(fetchMock, '/api/sessions/session-1', 'DELETE')).toBeTruthy(),
  );

  await user.click(screen.getByRole('button', { name: 'Revoke local' }));
  await waitFor(() =>
    expect(mutationCall(fetchMock, '/api/admin-sessions/admin-1', 'DELETE')).toBeTruthy(),
  );

  await user.click(screen.getByRole('button', { name: 'Revoke other sessions' }));
  await waitFor(() =>
    expect(mutationCall(fetchMock, '/api/admin-sessions/revoke-others', 'POST')).toBeTruthy(),
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
      '/api/changes': [{ id: 'change-1', name: 'Work', state: 'open', workspaceId: 'ws-1' }],
    },
  });
  render(<ChangesPage />);

  expect(await screen.findByRole('heading', { name: 'Changes' })).toBeInTheDocument();
  for (const [label, action] of [
    ['Rename', 'rename'],
    ['Keep', 'keep'],
    ['Rollback', 'rollback'],
  ] as const) {
    await user.click(screen.getByRole('button', { name: label }));
    await waitFor(() =>
      expect(mutationCall(fetchMock, `/api/changes/change-1/${action}`, 'POST')).toBeTruthy(),
    );
  }
});

test('Audit renders exported events and clears history only through the mutation endpoint', async () => {
  const user = userEvent.setup();
  const fetchMock = installApiFixtures({
    routes: {
      '/api/audit/export?format=json': [
        { id: 1, action: 'workspace.select', actor: 'ChatGPT', at: '2026-08-19T00:00:00Z' },
      ],
    },
  });
  render(<AuditPage />);

  expect(await screen.findByRole('heading', { name: 'Audit' })).toBeInTheDocument();
  expect(await screen.findByText('workspace.select')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Clear history' }));
  await waitFor(() => expect(mutationCall(fetchMock, '/api/audit', 'DELETE')).toBeTruthy());
});
