import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
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
