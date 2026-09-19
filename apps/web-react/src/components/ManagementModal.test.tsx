import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { expect, test, vi } from 'vitest';
import { ManagementModal } from './ManagementModal';

function Fixture({
  empty = false,
  initialOpen = false,
}: {
  empty?: boolean;
  initialOpen?: boolean;
}) {
  const [open, setOpen] = useState(initialOpen);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open modal
      </button>
      <ManagementModal open={open} title="Example modal" onClose={() => setOpen(false)}>
        {!empty ? (
          <>
            <button type="button">First action</button>
            <button type="button">Last action</button>
          </>
        ) : null}
      </ManagementModal>
    </>
  );
}

test('management modal receives focus and traps reverse Tab at its first control', async () => {
  const user = userEvent.setup();
  render(<Fixture initialOpen={true} />);

  const dialog = screen.getByRole('dialog', { name: 'Example modal' });
  expect(dialog).toHaveFocus();

  screen.getByRole('button', { name: 'Close' }).focus();
  await user.keyboard('{Shift>}{Tab}{/Shift}');
  expect(screen.getByRole('button', { name: 'Last action' })).toHaveFocus();

  // Forward tab from last control wraps to first (Close button)
  await user.keyboard('{Tab}');
  expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
});

test('traps tab when no focusable elements are inside the modal body', async () => {
  const user = userEvent.setup();
  // If close button is disabled, there might be no focusable elements
  const onClose = vi.fn();
  render(
    <ManagementModal open={true} title="Empty modal" onClose={onClose}>
      <p>Plain text</p>
    </ManagementModal>,
  );

  const dialog = screen.getByRole('dialog', { name: 'Empty modal' });
  expect(dialog).toHaveFocus();

  // Disable the close button to test the !focusable.length branch
  const closeBtn = screen.getByRole('button', { name: 'Close' });
  closeBtn.setAttribute('disabled', 'true');

  await user.keyboard('{Tab}');
  expect(dialog).toHaveFocus();
});

test('closes on Escape key press or backdrop click', async () => {
  const user = userEvent.setup();
  const onClose = vi.fn();
  const { rerender } = render(
    <ManagementModal open={true} title="Closable modal" onClose={onClose}>
      <p>Content</p>
    </ManagementModal>,
  );

  await user.keyboard('{Escape}');
  expect(onClose).toHaveBeenCalledTimes(1);

  const backdrop = document.querySelector('.management-modal-backdrop')!;
  fireEvent.mouseDown(backdrop, { target: backdrop });
  expect(onClose).toHaveBeenCalledTimes(2);

  // Closed modal renders nothing
  rerender(
    <ManagementModal open={false} title="Closable modal" onClose={onClose}>
      <p>Content</p>
    </ManagementModal>,
  );
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
