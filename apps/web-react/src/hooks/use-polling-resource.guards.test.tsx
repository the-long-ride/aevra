import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { usePollingResource } from './use-polling-resource';

type Load = (signal: AbortSignal) => Promise<string>;

afterEach(() => vi.useRealTimers());

test('a slow request is not aborted by the next timer tick', async () => {
  vi.useFakeTimers();
  const resolvers: Array<(value: string) => void> = [];
  const signals: AbortSignal[] = [];
  const load: Load = vi.fn(
    (signal) =>
      new Promise<string>((resolve) => {
        signals.push(signal);
        resolvers.push(resolve);
      }),
  );
  const { result } = renderHook(() => usePollingResource({ load, intervalMs: 1000 }));

  await act(async () => {
    await vi.advanceTimersByTimeAsync(3500);
  });
  expect(load).toHaveBeenCalledTimes(1);
  expect(signals[0]?.aborted).toBe(false);

  await act(async () => {
    resolvers[0]?.('slow');
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(result.current.data).toBe('slow');

  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(load).toHaveBeenCalledTimes(2);
});

test('a request stuck past the stale limit is replaced by the next tick', async () => {
  vi.useFakeTimers();
  const signals: AbortSignal[] = [];
  const load: Load = vi.fn(
    (signal) =>
      new Promise<string>(() => {
        signals.push(signal);
      }),
  );
  renderHook(() => usePollingResource({ load, intervalMs: 1000 }));

  await act(async () => {
    await vi.advanceTimersByTimeAsync(31_000);
  });
  expect(load).toHaveBeenCalledTimes(2);
  expect(signals[0]?.aborted).toBe(true);
});

test('changing load drops the previous data instead of showing it as current', async () => {
  let release: ((value: string) => void) | undefined;
  const first: Load = vi.fn(async () => 'one');
  const second: Load = vi.fn(
    () =>
      new Promise<string>((resolve) => {
        release = resolve;
      }),
  );
  const { result, rerender } = renderHook(({ load }) => usePollingResource({ load }), {
    initialProps: { load: first },
  });
  await waitFor(() => expect(result.current.data).toBe('one'));

  rerender({ load: second });
  await waitFor(() => expect(second).toHaveBeenCalledTimes(1));
  expect(result.current.data).toBeNull();
  expect(result.current.loading).toBe(true);

  await act(async () => {
    release?.('two');
  });
  await waitFor(() => expect(result.current.data).toBe('two'));
});

test('changing load clears the previous error', async () => {
  const failing: Load = vi.fn(async () => {
    throw new Error('old');
  });
  const pending: Load = vi.fn(() => new Promise<string>(() => undefined));
  const { result, rerender } = renderHook(({ load }) => usePollingResource({ load }), {
    initialProps: { load: failing },
  });
  await waitFor(() => expect(result.current.error?.message).toBe('old'));

  rerender({ load: pending });
  await waitFor(() => expect(result.current.error).toBeNull());
});
