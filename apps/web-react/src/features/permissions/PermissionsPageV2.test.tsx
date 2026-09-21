import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { DialogProvider } from '../../components/Dialog';
import { installApiFixtures } from '../../test/api-fixtures';
import { PermissionsPage } from './PermissionsPage';

test('PermissionsPage: validates workspace requirement and cancel in V2 modal', async () => {
  const user = userEvent.setup();
  installApiFixtures({
    routes: {
      '/api/permissions': [],
      '/api/workspaces': [],
    },
  });

  render(
    <DialogProvider>
      <PermissionsPage />
    </DialogProvider>,
  );

  await user.click(await screen.findByRole('button', { name: 'Add typed rule' }));
  await user.click(screen.getByRole('button', { name: 'Save Rule' }));

  expect(await screen.findByText('Workspace is required for this rule')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByText('Add typed command rule')).not.toBeInTheDocument();
});

test('PermissionsPage: creates new V2 typed command rule', async () => {
  const user = userEvent.setup();
  const fetchMock = installApiFixtures({
    routes: {
      '/api/permissions': [],
      '/api/workspaces': [{ id: 'ws-1', name: 'Main Repo', hostRoot: '/tmp/repo' }],
    },
  });

  render(
    <DialogProvider>
      <PermissionsPage />
    </DialogProvider>,
  );

  await user.click(await screen.findByRole('button', { name: 'Add typed rule' }));
  expect(screen.getByText('Add typed command rule')).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: 'Save Rule' }));

  await waitFor(() => {
    const postCall = fetchMock.mock.calls.find(
      ([url, init]) => url === '/api/permissions' && init?.method === 'POST',
    );
    expect(postCall).toBeTruthy();
    const payload = JSON.parse(String(postCall?.[1]?.body));
    expect(payload.version).toBe(2);
    expect(payload.workspaceId).toBe('ws-1');
    expect(payload.matcher).toBe('git:status');
  });
});

test('PermissionsPage: displays statuses and allows editing existing V2 rule', async () => {
  const user = userEvent.setup();
  const fetchMock = installApiFixtures({
    routes: {
      '/api/permissions': [
        {
          id: 'rule-v2',
          version: 2,
          capability: 'commands.run',
          matcher: 'git:status',
          workspaceId: 'ws-1',
          predicate_json: JSON.stringify({
            version: 2,
            application: 'git',
            operation: ['status'],
            allowedModifiers: [],
            allowedOptions: [],
            positionalConstraint: 'workspace-paths',
            targetScope: 'workspace',
            backends: ['host'],
            dialects: ['direct'],
            executableFingerprint: '*',
            wrapperFingerprints: ['*'],
          }),
        },
        {
          id: 'rule-review',
          status: 'needs-review',
          capability: 'files.write',
          matcher: '*',
        },
        {
          id: 'rule-active',
          status: 'active',
          capability: 'files.read',
          matcher: '*',
        },
      ],
      '/api/workspaces': [{ id: 'ws-1', name: 'Main Repo', hostRoot: '/tmp/repo' }],
    },
  });

  render(
    <DialogProvider>
      <PermissionsPage />
    </DialogProvider>,
  );

  expect(await screen.findByText('v2')).toBeInTheDocument();
  expect(screen.getByText('needs-review')).toBeInTheDocument();
  expect(screen.getByText('active')).toBeInTheDocument();

  const editBtn = screen.getByRole('button', { name: 'Edit' });
  await user.click(editBtn);

  expect(screen.getByText('Edit typed command rule')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Save Rule' }));

  await waitFor(() => {
    const postCall = fetchMock.mock.calls.find(
      ([url, init]) => url === '/api/permissions' && init?.method === 'POST',
    );
    expect(postCall).toBeTruthy();
  });
});

test('PermissionsPage: no-op edit preserves snake-case workspace ownership and predicate fields', async () => {
  const user = userEvent.setup();
  const predicate = {
    version: 2,
    application: 'npm',
    operation: ['run', 'build'],
    scriptName: 'build',
    allowedModifiers: ['force'],
    allowedOptions: [{ name: '--workspace', values: ['packages/api'] }],
    positionalConstraint: 'exact',
    exactArgv: ['npm', 'run', 'build', '--workspace', 'packages/api'],
    targetScope: 'workspace',
    backends: ['host'],
    dialects: ['direct'],
    executableFingerprint: 'exe-fingerprint',
    wrapperFingerprints: ['wrapper-fingerprint'],
    scriptFingerprint: 'script-fingerprint',
  };
  const fetchMock = installApiFixtures({
    routes: {
      '/api/permissions': [
        {
          id: 'rule-v2',
          version: 2,
          effect: 'allow',
          capability: 'commands.run',
          scope: 'workspace',
          workspace_id: 'ws-2',
          matcher: 'npm:run:build',
          predicate_json: JSON.stringify(predicate),
        },
      ],
      '/api/workspaces': [
        { id: 'ws-1', name: 'First Repo', hostRoot: '/tmp/one' },
        { id: 'ws-2', name: 'Second Repo', hostRoot: '/tmp/two' },
      ],
    },
  });

  render(
    <DialogProvider>
      <PermissionsPage />
    </DialogProvider>,
  );

  await user.click(await screen.findByRole('button', { name: 'Edit' }));
  await user.click(screen.getByRole('button', { name: 'Save Rule' }));

  await waitFor(() => {
    const postCall = fetchMock.mock.calls.find(
      ([url, init]) => url === '/api/permissions' && init?.method === 'POST',
    );
    expect(postCall).toBeTruthy();
    const payload = JSON.parse(String(postCall?.[1]?.body));
    expect(payload.workspaceId).toBe('ws-2');
    expect(JSON.parse(payload.predicate_json)).toEqual(predicate);
  });
});

test('PermissionsPage: displays error on V2 save failure and closes via Close button', async () => {
  const user = userEvent.setup();
  installApiFixtures({
    routes: {
      '/api/permissions': [],
      '/api/workspaces': [{ id: 'ws-1', name: 'Main Repo', hostRoot: '/tmp/repo' }],
    },
    mutationResponses: {
      'POST /api/permissions': new Response(
        JSON.stringify({ error: { message: 'Server explosion' } }),
        { status: 500, headers: { 'content-type': 'application/json' } },
      ),
    },
  });

  render(
    <DialogProvider>
      <PermissionsPage />
    </DialogProvider>,
  );

  await user.click(await screen.findByRole('button', { name: 'Add typed rule' }));
  await user.click(screen.getByRole('button', { name: 'Save Rule' }));

  expect(await screen.findByText('Server explosion')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Close' }));
  expect(screen.queryByText('Add typed command rule')).not.toBeInTheDocument();
});
