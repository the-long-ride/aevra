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
      'POST /api/workspaces/ws-main/mounts': new Response('{}', { status: 200 }),
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
  expect(within(details).getByText('pol-read')).toBeInTheDocument();

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

  // 2. Open details of ws-existing-root, verify 'Default' sensitivity, change name without changing hostRoot
  await user.click(detailsButtons[0]); // ws-existing-root
  details = screen.getByRole('dialog', { name: 'Existing Root WS' });
  expect(within(details).getByText('Default')).toBeInTheDocument();

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
