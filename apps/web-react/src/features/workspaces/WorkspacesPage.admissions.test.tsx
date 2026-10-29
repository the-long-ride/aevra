import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { DialogProvider } from '../../components/Dialog';
import { installApiFixtures } from '../../test/api-fixtures';
import { WorkspacesPage } from './WorkspacesPage';

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
  const profileDropdown = within(details).getByRole('button', {
    name: 'Profile for connector:ChatGPT',
  });
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
    fetchMock.mock.calls.some(
      ([url, init]) => String(url).includes('/admission') && init?.method === 'DELETE',
    ),
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
