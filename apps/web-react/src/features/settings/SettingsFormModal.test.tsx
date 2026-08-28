import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { SettingsFormModal } from './SettingsFormModal';

test('idle settings modal closes from Escape and backdrop without optional presentation', async () => {
  const onClose = vi.fn();
  const onSubmit = vi.fn();
  render(
    <SettingsFormModal
      title="Plain settings"
      submitting={false}
      submitLabel="Save"
      submittingLabel="Saving…"
      onClose={onClose}
      onSubmit={onSubmit}
    >
      <span>Modal body</span>
    </SettingsFormModal>,
  );

  const dialog = screen.getByRole('dialog', { name: 'Plain settings' });
  expect(dialog).not.toHaveClass('settings-form-modal-half');
  expect(screen.queryByText(/description/i)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();

  fireEvent.keyDown(window, { key: 'Escape' });
  expect(onClose).toHaveBeenCalledOnce();

  onClose.mockClear();
  fireEvent.mouseDown(dialog.parentElement!);
  expect(onClose).toHaveBeenCalledOnce();

  onClose.mockClear();
  fireEvent.mouseDown(dialog);
  expect(onClose).not.toHaveBeenCalled();

  await userEvent.setup().click(screen.getByRole('button', { name: 'Cancel' }));
  expect(onClose).toHaveBeenCalledOnce();
});

test('submitting settings modal stays open and exposes busy presentation', async () => {
  const onClose = vi.fn();
  render(
    <SettingsFormModal
      title="Busy settings"
      description="Saving the current settings"
      submitting
      submitLabel="Save"
      submittingLabel="Saving…"
      halfWidth
      onClose={onClose}
      onSubmit={vi.fn()}
    >
      <span>Modal body</span>
    </SettingsFormModal>,
  );

  const dialog = screen.getByRole('dialog', { name: 'Busy settings' });
  expect(dialog).toHaveClass('settings-form-modal-half');
  expect(screen.getByText('Saving the current settings')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();

  fireEvent.keyDown(window, { key: 'Escape' });
  fireEvent.mouseDown(dialog.parentElement!);
  expect(onClose).not.toHaveBeenCalled();
});
