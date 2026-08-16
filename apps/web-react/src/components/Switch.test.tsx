import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { Switch } from './Switch';

test('switch exposes accessible state and toggles with native checkbox semantics', async () => {
  const user = userEvent.setup();
  render(<Switch label="Network" name="capability" value="network" />);
  const control = screen.getByRole('switch', { name: 'Network' });
  expect(control).not.toBeChecked();
  expect(control).toHaveAttribute('aria-checked', 'false');
  await user.click(control);
  expect(control).toBeChecked();
  expect(control).toHaveAttribute('aria-checked', 'true');
});

test('switch participates in FormData and supports default checked and disabled states', () => {
  render(
    <form data-testid="form">
      <Switch label="Read files" name="capability" value="files.read" defaultChecked />
      <Switch label="Delete files" name="capability" value="files.delete" disabled />
    </form>,
  );
  const form = screen.getByTestId('form') as HTMLFormElement;
  expect(screen.getByRole('switch', { name: 'Read files' })).toBeChecked();
  expect(screen.getByRole('switch', { name: 'Delete files' })).toBeDisabled();
  expect(new FormData(form).getAll('capability')).toEqual(['files.read']);
});
