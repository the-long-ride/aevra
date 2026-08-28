import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { expect, test } from 'vitest';
import { ManagementModal } from './ManagementModal';

function Fixture() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open modal
      </button>
      <ManagementModal open={open} title="Example modal" onClose={() => setOpen(false)}>
        <button type="button">First action</button>
        <button type="button">Last action</button>
      </ManagementModal>
    </>
  );
}

test('management modal receives focus and traps reverse Tab at its first control', async () => {
  const user = userEvent.setup();
  render(<Fixture />);

  await user.click(screen.getByRole('button', { name: 'Open modal' }));
  const dialog = screen.getByRole('dialog', { name: 'Example modal' });
  expect(dialog).toHaveFocus();

  screen.getByRole('button', { name: 'Close' }).focus();
  await user.keyboard('{Shift>}{Tab}{/Shift}');
  expect(screen.getByRole('button', { name: 'Last action' })).toHaveFocus();
});
