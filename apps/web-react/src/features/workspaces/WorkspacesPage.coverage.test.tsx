import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { DialogProvider } from '../../components/Dialog';
import { installApiFixtures } from '../../test/api-fixtures';
import { WorkspacesPage } from './WorkspacesPage';

test('workspace details save a changed root and workspace removal honors cancel then confirm', async () => {
  const fetchMock = installApiFixtures({
    routes: {
      '/api/workspaces': [
        {
          id: 'ws-1',
          name: 'Aevra',
          description: 'Local workspace',
          hostRoot: '/repo',
        },
      ],
      '/api/workspaces/ws-1/mounts': [],
    },
  });
  const user = userEvent.setup();
  render(
    <DialogProvider>
      <WorkspacesPage />
    </DialogProvider>,
  );

  expect(await screen.findByRole('heading', { name: 'Workspaces' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Details' }));
  const details = screen.getByRole('dialog', { name: 'Aevra' });
  const root = within(details).getByLabelText('Root local path');
  await user.clear(root);
  await user.type(root, '/repo-next');
  await user.click(within(details).getByRole('button', { name: 'Save changes' }));

  await waitFor(() => {
    const call = fetchMock.mock.calls.find(
      ([input, init]) => input === '/api/workspaces/ws-1' && init?.method === 'PATCH',
    );
    expect(call).toBeTruthy();
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      name: 'Aevra',
      description: 'Local workspace',
      hostRoot: '/repo-next',
    });
  });

  const removeWorkspace = document.querySelector<HTMLButtonElement>(
    '[data-surface-id="workspaces:remove"]',
  );
  expect(removeWorkspace).not.toBeNull();

  await user.click(removeWorkspace!);
  let confirmation = screen.getByRole('dialog', { name: 'Remove workspace' });
  await user.click(within(confirmation).getByRole('button', { name: 'Cancel' }));
  expect(
    fetchMock.mock.calls.some(
      ([input, init]) => input === '/api/workspaces/ws-1' && init?.method === 'DELETE',
    ),
  ).toBe(false);
  expect(screen.getByRole('dialog', { name: 'Aevra' })).toBeInTheDocument();

  await user.click(removeWorkspace!);
  confirmation = screen.getByRole('dialog', { name: 'Remove workspace' });
  await user.click(within(confirmation).getByRole('button', { name: 'Remove' }));
  await waitFor(() =>
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) => input === '/api/workspaces/ws-1' && init?.method === 'DELETE',
      ),
    ).toBe(true),
  );
  expect(screen.queryByRole('dialog', { name: 'Aevra' })).not.toBeInTheDocument();
});

test('copies workspace ID to clipboard', async () => {
  installApiFixtures({
    routes: {
      '/api/workspaces': [
        {
          id: 'ws-copy-test',
          name: 'Clipboard Workspace',
          hostRoot: '/repo',
        },
      ],
      '/api/workspaces/ws-copy-test/mounts': [],
    },
  });

  const user = userEvent.setup();
  render(
    <DialogProvider>
      <WorkspacesPage />
    </DialogProvider>,
  );

  const writeTextSpy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);

  const copyButton = await screen.findByRole('button', { name: 'Copy ID' });
  await user.click(copyButton);

  expect(writeTextSpy).toHaveBeenCalledWith('ws-copy-test');
  expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
});

test('manages mounts, admission, and modal close mechanisms', async () => {
  const fetchMock = installApiFixtures({
    routes: {
      '/api/workspaces': [
        {
          id: 'ws-main',
          name: 'Main Workspace',
          hostRoot: '/main',
        },
      ],
      '/api/workspaces/ws-main/mounts': [
        {
          id: 'mount-1',
          logicalPath: '/docs',
          hostRoot: '/external/docs',
          capabilities: ['files.read'],
          sensitivityPolicyId: 'pol-read',
        },
      ],
    },
    mutationResponses: {
      'POST /api/workspaces/ws-main/mounts': {},
      'DELETE /api/mounts/mount-1': new Response('{}', { status: 200 }),
      'POST /api/workspaces/ws-main/admission': new Response('{}', { status: 200 }),
    },
  });

  const user = userEvent.setup();
  render(
    <DialogProvider>
      <WorkspacesPage />
    </DialogProvider>,
  );

  // Open Details
  await user.click(await screen.findByRole('button', { name: 'Details' }));
  const details = screen.getByRole('dialog', { name: 'Main Workspace' });
  expect(within(details).getByText('/docs')).toBeInTheDocument();
  expect(within(details).queryByText('pol-read')).not.toBeInTheDocument();
  expect(
    within(details).queryByRole('columnheader', { name: 'Sensitivity policy' }),
  ).not.toBeInTheDocument();

  // Add mount
  await user.type(within(details).getByLabelText('Logical path'), '/assets');
  await user.type(within(details).getByLabelText('Local mount root'), '/external/assets');
  await user.click(within(details).getByRole('button', { name: 'Add mount' }));

  await waitFor(() => {
    const addMountCall = fetchMock.mock.calls.find(
      ([url, init]) => url === '/api/workspaces/ws-main/mounts' && init?.method === 'POST',
    );
    expect(addMountCall).toBeTruthy();
    expect(JSON.parse(String(addMountCall?.[1]?.body))).toEqual({
      logicalPath: '/assets',
      hostRoot: '/external/assets',
      capabilities: ['files.read', 'files.search'],
    });
  });

  // Add mount with only absolute Local mount root (leaving Logical path blank)
  await user.clear(within(details).getByLabelText('Logical path'));
  await user.clear(within(details).getByLabelText('Local mount root'));
  await user.type(within(details).getByLabelText('Local mount root'), 'D:\\design-system\\icons');
  await user.click(within(details).getByRole('button', { name: 'Add mount' }));

  await waitFor(() => {
    const addMountCalls = fetchMock.mock.calls.filter(
      ([url, init]) => url === '/api/workspaces/ws-main/mounts' && init?.method === 'POST',
    );
    expect(addMountCalls).toHaveLength(2);
    expect(JSON.parse(String(addMountCalls[1]?.[1]?.body))).toEqual({
      logicalPath: 'D:\\design-system\\icons',
      hostRoot: 'D:\\design-system\\icons',
      capabilities: ['files.read', 'files.search'],
    });
  });

  // Add mount with absolute path in Logical path (leaving Local mount root blank)
  await user.clear(within(details).getByLabelText('Logical path'));
  await user.clear(within(details).getByLabelText('Local mount root'));
  await user.type(within(details).getByLabelText('Logical path'), 'D:\\shared-lib');
  await user.click(within(details).getByRole('button', { name: 'Add mount' }));

  await waitFor(() => {
    const addMountCalls = fetchMock.mock.calls.filter(
      ([url, init]) => url === '/api/workspaces/ws-main/mounts' && init?.method === 'POST',
    );
    expect(addMountCalls).toHaveLength(3);
    expect(JSON.parse(String(addMountCalls[2]?.[1]?.body))).toEqual({
      logicalPath: 'D:\\shared-lib',
      hostRoot: 'D:\\shared-lib',
      capabilities: ['files.read', 'files.search'],
    });
  });

  // Submitting empty mount form is a no-op
  await user.clear(within(details).getByLabelText('Logical path'));
  await user.clear(within(details).getByLabelText('Local mount root'));
  await user.click(within(details).getByRole('button', { name: 'Add mount' }));
  expect(
    fetchMock.mock.calls.filter(
      ([url, init]) => url === '/api/workspaces/ws-main/mounts' && init?.method === 'POST',
    ),
  ).toHaveLength(3);

  // Remove mount (cancel then confirm)
  const removeMountBtn = within(details).getByRole('button', { name: 'Remove' });
  await user.click(removeMountBtn);
  const cancelMountDialog = screen.getByRole('dialog', { name: 'Remove external mount' });
  await user.click(within(cancelMountDialog).getByRole('button', { name: 'Cancel' }));
  expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/mounts/mount-1'))).toBe(
    false,
  );

  await user.click(removeMountBtn);
  const confirmMountDialog = screen.getByRole('dialog', { name: 'Remove external mount' });
  await user.click(within(confirmMountDialog).getByRole('button', { name: 'Remove' }));
  await waitFor(() => {
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) => url === '/api/mounts/mount-1' && init?.method === 'DELETE',
      ),
    ).toBe(true);
  });

  // Save admission
  await user.type(within(details).getByLabelText('Actor'), 'connector:ChatGPT');
  await user.click(within(details).getByRole('button', { name: 'Save admission' }));
  await waitFor(() => {
    const admissionCall = fetchMock.mock.calls.find(
      ([url, init]) => url === '/api/workspaces/ws-main/admission' && init?.method === 'POST',
    );
    expect(admissionCall).toBeTruthy();
  });

  // Close details via Close button
  await user.click(within(details).getByRole('button', { name: 'Close' }));
  expect(screen.queryByRole('dialog', { name: 'Main Workspace' })).not.toBeInTheDocument();

  // Open details again and close via backdrop click
  await user.click(screen.getByRole('button', { name: 'Details' }));
  expect(screen.getByRole('dialog', { name: 'Main Workspace' })).toBeInTheDocument();
  const backdrop = document.querySelector('.modal-backdrop')!;
  fireEvent.mouseDown(backdrop, { target: backdrop });
  expect(screen.queryByRole('dialog', { name: 'Main Workspace' })).not.toBeInTheDocument();

  // Open and close AddWorkspaceModal
  await user.click(screen.getByRole('button', { name: 'Add workspace' }));
  expect(screen.getByRole('dialog', { name: 'Add workspace' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Close Add workspace' }));
  expect(screen.queryByRole('dialog', { name: 'Add workspace' })).not.toBeInTheDocument();
});

test('saves workspace details without changing hostRoot and handles empty hostRoot and mount defaults', async () => {
  const fetchMock = installApiFixtures({
    routes: {
      '/api/workspaces': [
        {
          id: 'ws-existing-root',
          name: 'Existing Root WS',
          hostRoot: '/var/repo',
        },
        {
          id: 'ws-no-root',
          name: 'No Root WS',
          hostRoot: undefined as any,
        },
      ],
      '/api/workspaces/ws-existing-root/mounts': [
        {
          id: 'mount-empty',
          logicalPath: '/bare',
          hostRoot: '/local/bare',
        },
      ],
      '/api/workspaces/ws-no-root/mounts': [],
    },
    mutationResponses: {
      'PATCH /api/workspaces/ws-existing-root': {},
    },
  });

  const user = userEvent.setup();
  render(
    <DialogProvider>
      <WorkspacesPage />
    </DialogProvider>,
  );

  // 1. Check details of ws-no-root to see '—'
  const detailsButtons = await screen.findAllByRole('button', { name: 'Details' });
  await user.click(detailsButtons[1]); // ws-no-root
  let details = screen.getByRole('dialog', { name: 'No Root WS' });
  expect(within(details).getByText('—')).toBeInTheDocument();
  await user.click(within(details).getByRole('button', { name: 'Close' }));

  // 2. Open details and change the name without changing hostRoot.
  await user.click(detailsButtons[0]); // ws-existing-root
  details = screen.getByRole('dialog', { name: 'Existing Root WS' });
  expect(
    within(details).queryByRole('columnheader', { name: 'Sensitivity policy' }),
  ).not.toBeInTheDocument();

  const nameInput = within(details).getByLabelText('Workspace name');
  await user.clear(nameInput);
  await user.type(nameInput, 'Renamed WS');
  await user.click(within(details).getByRole('button', { name: 'Save changes' }));

  await waitFor(() => {
    const call = fetchMock.mock.calls.find(
      ([url, init]) => url === '/api/workspaces/ws-existing-root' && init?.method === 'PATCH',
    );
    expect(call).toBeTruthy();
    const payload = JSON.parse(String(call?.[1]?.body));
    expect(payload.name).toBe('Renamed WS');
    expect(payload.hostRoot).toBeUndefined();
  });
});
test('supports actor admissions table, inline editing, revocation, and mount capabilities configuration', async () => {
  const fetchMock = installApiFixtures({
    routes: {
      '/api/workspaces': [
        {
          id: 'ws-advanced',
          name: 'Advanced WS',
          hostRoot: '/projects/advanced',
        },
      ],
      '/api/workspaces/ws-advanced/mounts': [
        {
          id: 'mount-101',
          logicalPath: '/data',
          hostRoot: '/var/data',
          capabilities: ['files.read', 'files.search'],
        },
      ],
      '/api/workspaces/ws-advanced/admissions': [
        {
          actor: 'connector:ChatGPT',
          workspaceId: 'ws-advanced',
          profileId: 'developer',
          admission: 'auto',
          profileName: 'Developer',
        },
      ],
      '/api/connectors': [
        { id: 'c-1', name: 'Claude' },
        { id: 'c-2', name: 'ChatGPT' },
      ],
      '/api/connections': [],
      '/api/sessions': [],
    },
    mutationResponses: {
      'POST /api/workspaces/ws-advanced/admission': { ok: true },
      'DELETE /api/workspaces/ws-advanced/admission/connector%3AChatGPT': { ok: true },
      'PATCH /api/mounts/mount-101': { ok: true },
      'POST /api/workspaces/ws-advanced/mounts': { ok: true },
    },
  });

  const user = userEvent.setup();
  render(
    <DialogProvider>
      <WorkspacesPage />
    </DialogProvider>,
  );

  await user.click(await screen.findByRole('button', { name: 'Details' }));
  const details = screen.getByRole('dialog', { name: 'Advanced WS' });

  // 1. Verify existing admitted actor is displayed in DataTable
  expect(within(details).getByText('connector:ChatGPT')).toBeInTheDocument();

  // 2. Change inline profile of admitted actor
  const profileDropdown = within(details).getByRole('button', { name: 'Profile for connector:ChatGPT' });
  await user.click(profileDropdown);
  await user.click(screen.getByRole('option', { name: 'Full Workspace' }));

  await waitFor(() => {
    const postCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        url === '/api/workspaces/ws-advanced/admission' &&
        init?.method === 'POST' &&
        JSON.parse(String(init?.body)).profileId === 'full-workspace',
    );
    expect(postCall).toBeTruthy();
  });

  // 3. Change inline admission mode of admitted actor
  const admissionDropdown = within(details).getByRole('button', {
    name: 'Admission policy for connector:ChatGPT',
  });
  await user.click(admissionDropdown);
  await user.click(screen.getByRole('option', { name: 'Ask every time' }));

  await waitFor(() => {
    const postCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        url === '/api/workspaces/ws-advanced/admission' &&
        init?.method === 'POST' &&
        JSON.parse(String(init?.body)).admission === 'ask',
    );
    expect(postCall).toBeTruthy();
  });

  // 4. Revoke actor admission with [x] button (cancel then confirm)
  const revokeAdmissionBtn = document.querySelector<HTMLButtonElement>(
    '[data-surface-id="workspaces:revoke-admission"]',
  );
  expect(revokeAdmissionBtn).not.toBeNull();
  expect(revokeAdmissionBtn?.textContent?.trim()).toBe('[x]');

  await user.click(revokeAdmissionBtn!);
  let confirmDialog = screen.getByRole('dialog', { name: 'Remove actor admission' });
  await user.click(within(confirmDialog).getByRole('button', { name: 'Cancel' }));
  expect(
    fetchMock.mock.calls.some(([url, init]) => String(url).includes('/admission') && init?.method === 'DELETE'),
  ).toBe(false);

  await user.click(revokeAdmissionBtn!);
  confirmDialog = screen.getByRole('dialog', { name: 'Remove actor admission' });
  await user.click(within(confirmDialog).getByRole('button', { name: 'Remove' }));

  await waitFor(() => {
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          String(url).includes('/api/workspaces/ws-advanced/admission/connector') &&
          init?.method === 'DELETE',
      ),
    ).toBe(true);
  });

  // 5. Update mount capability in DataTable
  const mountCapDropdown = within(details).getByRole('button', { name: 'Capabilities for /data' });
  await user.click(mountCapDropdown);
  await user.click(screen.getByRole('option', { name: 'Read & Write' }));

  await waitFor(() => {
    const patchCall = fetchMock.mock.calls.find(
      ([url, init]) => url === '/api/mounts/mount-101' && init?.method === 'PATCH',
    );
    expect(patchCall).toBeTruthy();
    expect(JSON.parse(String(patchCall?.[1]?.body))).toEqual({
      capabilities: ['files.read', 'files.search', 'files.write', 'files.delete'],
    });
  });

  // 6. Add mount with Read & Write capability preset
  const addMountForm = within(details).getByRole('button', { name: 'Add mount' }).closest('form')!;
  await user.type(within(addMountForm).getByLabelText('Logical path'), '/extra');
  await user.type(within(addMountForm).getByLabelText('Local mount root'), '/opt/extra');
  const addMountCapDropdown = within(addMountForm).getByRole('button', { name: 'Capabilities' });
  await user.click(addMountCapDropdown);
  await user.click(screen.getByRole('option', { name: 'Full Access' }));
  await user.click(within(addMountForm).getByRole('button', { name: 'Add mount' }));

  await waitFor(() => {
    const postCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        url === '/api/workspaces/ws-advanced/mounts' &&
        init?.method === 'POST' &&
        JSON.parse(String(init?.body)).logicalPath === '/extra',
    );
    expect(postCall).toBeTruthy();
    expect(JSON.parse(String(postCall?.[1]?.body))).toEqual({
      logicalPath: '/extra',
      hostRoot: '/opt/extra',
      capabilities: ['files.read', 'files.search', 'files.write', 'files.delete', 'commands.run'],
    });
  });
});
