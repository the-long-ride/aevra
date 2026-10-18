import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { DialogProvider } from '../../components/Dialog';
import { installApiFixtures } from '../../test/api-fixtures';
import { ConnectionDetailModal } from './ConnectionDetailModal';

test('the connection modal isolates the page and yields to a confirm opened from it', async () => {
  const user = userEvent.setup();
  installApiFixtures({ routes: {} });
  render(
    <DialogProvider>
      <button type="button">Outside</button>
      <ConnectionDetailModal
        connection={{ id: 'ses-plain', client: 'ChatGPT' }}
        workspaces={[]}
        onClose={vi.fn()}
        onChanged={vi.fn(async () => undefined)}
      />
    </DialogProvider>,
  );
  const outside = screen.getByRole('button', { name: 'Outside', hidden: true });
  const modal = document.querySelector('.connection-modal')!;
  expect(outside.closest('[inert]')).not.toBeNull();
  expect(modal.closest('[inert]')).toBeNull();
  expect(document.body.style.overflow).toBe('hidden');

  await user.click(screen.getByRole('button', { name: 'Revoke session' }));
  const confirm = await screen.findByRole('dialog', { name: 'Revoke session' });
  expect(confirm.closest('[inert]')).toBeNull();
  expect(modal.closest('[inert]')).not.toBeNull();

  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Revoke session' })).toBeNull());
  expect(modal.closest('[inert]')).toBeNull();
  expect(outside.closest('[inert]')).not.toBeNull();
  expect(document.body.style.overflow).toBe('hidden');
});
