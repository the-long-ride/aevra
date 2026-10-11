import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { LoginPanel } from './LoginPanel';

test('shows a countdown and disables sign-in while locked', () => {
  render(
    <LoginPanel
      busy={false}
      error="Too many login attempts. Try again later."
      retryAfterSeconds={75}
      onSubmit={vi.fn()}
    />,
  );

  expect(screen.getByRole('alert')).toHaveTextContent('Too many login attempts');
  expect(screen.getByRole('timer')).toHaveTextContent('Try again in 1m 15s');
  expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled();
});

test('shows no countdown and keeps sign-in enabled when not locked', () => {
  const { rerender } = render(<LoginPanel busy={false} error={null} onSubmit={vi.fn()} />);
  expect(screen.queryByRole('timer')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();

  rerender(<LoginPanel busy={false} error={null} retryAfterSeconds={0} onSubmit={vi.fn()} />);
  expect(screen.queryByRole('timer')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
});

test('does not submit while locked even when the form is submitted directly', () => {
  const onSubmit = vi.fn(async () => undefined);
  render(<LoginPanel busy={false} error={null} retryAfterSeconds={30} onSubmit={onSubmit} />);

  const form = screen.getByRole('button', { name: 'Sign in' }).closest('form')!;
  fireEvent.submit(form);
  expect(onSubmit).not.toHaveBeenCalled();
});
