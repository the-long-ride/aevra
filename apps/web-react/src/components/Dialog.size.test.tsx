import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { DialogProvider, useDialog } from './Dialog';

function Opener({ size }: { size?: 'wide' }) {
  const dialog = useDialog();
  return (
    <button type="button" onClick={() => void dialog.message({ title: 'Details', size })}>
      Open
    </button>
  );
}

test('message dialogs can request the wide size', async () => {
  const user = userEvent.setup();
  render(
    <DialogProvider>
      <Opener size="wide" />
    </DialogProvider>,
  );
  await user.click(screen.getByRole('button', { name: 'Open' }));
  expect(screen.getByRole('dialog')).toHaveClass('common-dialog', 'wide');
});

test('message dialogs keep the default size otherwise', async () => {
  const user = userEvent.setup();
  render(
    <DialogProvider>
      <Opener />
    </DialogProvider>,
  );
  await user.click(screen.getByRole('button', { name: 'Open' }));
  expect(screen.getByRole('dialog')).not.toHaveClass('wide');
});
