import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { DialogProvider } from '../../components/Dialog';
import { installApiFixtures } from '../../test/api-fixtures';
import { ChangesPanel } from './ChangesPanel';

test('change rows use id fallback, hide closed mutations, and honor cancelled dialogs', async () => {
  const fetchMock = installApiFixtures({
    routes: {
      '/api/changes': [
        { id: 'change-open', name: 'Open work', state: 'OPEN', workspace_id: 'ws-1' },
        { id: 'change-closed', state: 'COMMITTED', workspace_id: 'ws-1' },
      ],
    },
  });
  const user = userEvent.setup();
  render(
    <DialogProvider>
      <ChangesPanel contained />
    </DialogProvider>,
  );

  expect(await screen.findByText('Open work')).toBeInTheDocument();
  const closedName = screen.getByText('change-closed');
  const closedRow = closedName.closest('tr');
  expect(closedRow).not.toBeNull();
  expect(within(closedRow!).queryByRole('button', { name: 'Keep' })).not.toBeInTheDocument();
  expect(within(closedRow!).queryByRole('button', { name: 'Rollback' })).not.toBeInTheDocument();

  const openRow = screen.getByText('Open work').closest('tr');
  expect(openRow).not.toBeNull();
  await user.click(within(openRow!).getByRole('button', { name: 'Rename' }));
  let dialog = screen.getByRole('dialog', { name: 'Rename change set' });
  await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect(
    fetchMock.mock.calls.some(
      ([input, init]) => input === '/api/changes/change-open' && init?.method === 'PATCH',
    ),
  ).toBe(false);

  await user.click(within(openRow!).getByRole('button', { name: 'Rollback' }));
  dialog = screen.getByRole('dialog', { name: 'Rollback change set' });
  await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect(
    fetchMock.mock.calls.some(
      ([input, init]) => input === '/api/changes/change-open/rollback' && init?.method === 'POST',
    ),
  ).toBe(false);
});
