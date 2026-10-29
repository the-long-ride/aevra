import { readFileSync } from 'node:fs';
import { StrictMode } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
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

function Callers({ first = true }: { first?: boolean }) {
  return (
    <>
      {first ? (
        <section aria-label="First caller">
          <Harness dismissMs={3000} />
        </section>
      ) : null}
      <section aria-label="Second caller">
        <Harness />
      </section>
    </>
  );
}

const callerPress = (caller: string, name: string) =>
  fireEvent.click(
    within(screen.getByRole('region', { name: caller })).getByRole('button', { name }),
  );

function showConcurrentNotices() {
  callerPress('First caller', 'fail');
  callerPress('Second caller', 'succeed');
}

test('concurrent callers put both notices in one stack outside their panels', () => {
  const { container } = render(<Callers />);
  showConcurrentNotices();
  const error = screen.getByRole('alert');
  const success = screen.getByRole('status');
  expect(error.parentElement).toBe(success.parentElement);
  expect(document.querySelectorAll('.toast-stack')).toHaveLength(1);
  expect(error.parentElement?.parentElement).toBe(document.body);
  expect(container).not.toContainElement(error);
  expect(error).toHaveTextContent('Broke it');
  expect(success).toHaveTextContent('Saved it');
});

test('callers keep their own dismiss delays in the shared stack', () => {
  render(<Callers />);
  showConcurrentNotices();
  advance(3000);
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByRole('status')).toHaveTextContent('Saved it');
  advance(1000);
  expect(screen.queryByRole('status')).toBeNull();
});

test('clearing one caller leaves the other notice visible', () => {
  render(<Callers />);
  showConcurrentNotices();
  callerPress('First caller', 'clear');
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByRole('status')).toHaveTextContent('Saved it');
  expect(document.querySelectorAll('.toast-stack')).toHaveLength(1);
});

test('unmounting one caller preserves the other stack and does not dismiss in-flight toasts', () => {
  const { rerender, unmount } = render(<Callers />);
  showConcurrentNotices();
  advance(1000);
  rerender(<Callers first={false} />);
  expect(screen.getByRole('alert')).toHaveTextContent('Broke it');
  expect(screen.getByRole('status')).toHaveTextContent('Saved it');
  expect(document.querySelectorAll('.toast-stack')).toHaveLength(1);
  advance(2000);
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByRole('status')).toHaveTextContent('Saved it');
  advance(1000);
  expect(screen.queryByRole('status')).toBeNull();
  unmount();
  expect(document.querySelector('.toast-stack')).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
});

test('StrictMode replay and a fresh mount leave only one owned stack', () => {
  const { unmount } = render(
    <StrictMode>
      <Callers />
    </StrictMode>,
  );
  showConcurrentNotices();
  expect(screen.getByRole('alert').parentElement).toBe(screen.getByRole('status').parentElement);
  expect(document.querySelectorAll('.toast-stack')).toHaveLength(1);
  unmount();
  expect(document.querySelector('.toast-stack')).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
  render(<Harness />);
  press('succeed');
  expect(screen.getByRole('status')).toBeInTheDocument();
  expect(document.querySelectorAll('.toast-stack')).toHaveLength(1);
});

test('toast text carries no prefix of its own; CSS draws it', () => {
  render(<Harness />);
  press('succeed');
  const toast = screen.getByRole('status');
  expect(toast.textContent).toBe('Saved it');
  press('fail');
  expect(screen.getByRole('alert').textContent).toBe('Broke it');
});

function PrefixedHarness() {
  const { toast, success } = useToast();
  return (
    <>
      <button onClick={() => success('// already prefixed')}>prefixed</button>
      {toast}
    </>
  );
}

test('a message that already starts with the prefix is not doubled', () => {
  render(<PrefixedHarness />);
  press('prefixed');
  expect(screen.getByRole('status').textContent).toBe('already prefixed');
});
test('every toast starts with the comment prefix drawn by CSS, hidden from screen readers', () => {
  const css = readFileSync('src/styles/dialog.css', 'utf8');
  expect(css).toMatch(/\.toast::before\s*\{[^}]*content:\s*'\/\/ '\s*\/\s*''/);
});
