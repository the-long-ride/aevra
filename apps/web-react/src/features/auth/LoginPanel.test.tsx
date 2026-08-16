import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { LoginPanel } from './LoginPanel';

test('submits the entered credentials to the onSubmit handler', async () => {
  const user = userEvent.setup();
  const onSubmit = vi.fn(async () => undefined);
  render(<LoginPanel busy={false} error={null} onSubmit={onSubmit} />);

  await user.type(screen.getByLabelText('Username'), 'admin');
  await user.type(screen.getByLabelText('Password'), 'hunter2');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));

  expect(onSubmit).toHaveBeenCalledWith({ username: 'admin', password: 'hunter2' });
});

test('busy state disables the form and relabels the submit button', () => {
  const onSubmit = vi.fn(async () => undefined);
  render(<LoginPanel busy error={null} onSubmit={onSubmit} />);

  expect(screen.getByLabelText('Username')).toBeDisabled();
  expect(screen.getByLabelText('Password')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Signing in…' })).toBeDisabled();
});

test('renders the login error as an alert', () => {
  render(<LoginPanel busy={false} error="Invalid credentials" onSubmit={vi.fn()} />);
  expect(screen.getByRole('alert')).toHaveTextContent('Invalid credentials');
});

test('renders and triggers theme toggle when provided', async () => {
  const user = userEvent.setup();
  const onToggleTheme = vi.fn();
  render(
    <LoginPanel
      busy={false}
      error={null}
      onSubmit={vi.fn()}
      theme="light"
      onToggleTheme={onToggleTheme}
    />,
  );

  const toggle = screen.getByRole('button', { name: 'Switch to dark mode' });
  expect(toggle).toHaveTextContent('[light]');
  await user.click(toggle);
  expect(onToggleTheme).toHaveBeenCalledTimes(1);
});
