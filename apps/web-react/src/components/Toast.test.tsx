import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { TOAST_DISMISS_MS, useToast } from './Toast';

function Harness({ dismissMs }: { dismissMs?: number }) {
  const { toast, success, error, clear } = useToast(dismissMs);
  return (
    <>
      <button onClick={() => success('Saved it', 'Save result')}>succeed</button>
      <button onClick={() => success('Saved again')}>succeed again</button>
      <button onClick={() => error(new Error('Broke it'))}>fail</button>
      <button onClick={() => error('plain failure')}>fail plain</button>
      <button onClick={clear}>clear</button>
      {toast}
    </>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

const press = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
const advance = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

test('renders nothing until a message is shown', () => {
  render(<Harness />);
  expect(screen.queryByRole('status')).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
});

test('success uses the existing toast markup with a status role and label', () => {
  render(<Harness />);
  press('succeed');
  const toast = screen.getByRole('status', { name: 'Save result' });
  expect(toast).toHaveClass('toast', 'success');
  expect(toast).toHaveTextContent('Saved it');
  expect(toast.parentElement).toHaveClass('toast-stack');
});

test('error shows an alert for an Error and for a plain string', () => {
  render(<Harness />);
  press('fail');
  expect(screen.getByRole('alert')).toHaveClass('toast', 'error');
  expect(screen.getByRole('alert')).toHaveTextContent('Broke it');
  press('fail plain');
  expect(screen.getByRole('alert')).toHaveTextContent('plain failure');
});

test('dismisses itself after the default delay', () => {
  render(<Harness />);
  press('succeed');
  advance(TOAST_DISMISS_MS - 1);
  expect(screen.getByRole('status')).toBeInTheDocument();
  advance(1);
  expect(screen.queryByRole('status')).toBeNull();
});

test('honours a custom delay', () => {
  render(<Harness dismissMs={3000} />);
  press('succeed');
  advance(3000);
  expect(screen.queryByRole('status')).toBeNull();
});

test('a new message restarts the dismiss timer', () => {
  render(<Harness />);
  press('succeed');
  advance(TOAST_DISMISS_MS - 1000);
  press('succeed again');
  advance(TOAST_DISMISS_MS - 1000);
  expect(screen.getByRole('status')).toHaveTextContent('Saved again');
  advance(1000);
  expect(screen.queryByRole('status')).toBeNull();
});

test('clear removes the toast immediately', () => {
  render(<Harness />);
  press('fail');
  press('clear');
  expect(screen.queryByRole('alert')).toBeNull();
});
