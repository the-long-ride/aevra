import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { usePollingResource } from './use-polling-resource';

afterEach(() => vi.useRealTimers());

test('polls on the requested interval without immediately looping after data changes', async () => {
  vi.useFakeTimers();
  const load = vi.fn(async () => ({ value: load.mock.calls.length }));
  const { result } = renderHook(() =>
    usePollingResource({ load, intervalMs: 2000 }),
  );

  await act(async () => {
    await Promise.resolve();
  });
  await waitFor(() => expect(result.current.data).not.toBeNull());
  expect(load).toHaveBeenCalledTimes(1);

  await act(async () => {
    await vi.advanceTimersByTimeAsync(1999);
  });
  expect(load).toHaveBeenCalledTimes(1);

  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(load).toHaveBeenCalledTimes(2);
});

test('manual refresh aborts the previous request and keeps the newest result', async () => {
  const resolvers: Array<(value: string) => void> = [];
  const load = vi.fn(
    (signal: AbortSignal) =>
      new Promise<string>((resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        resolvers.push(resolve);
      }),
  );
  const { result } = renderHook(() => usePollingResource({ load }));

  await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
  await act(async () => {
    void result.current.refresh();
    await Promise.resolve();
  });
  expect(load).toHaveBeenCalledTimes(2);

  await act(async () => {
    resolvers[1]?.('newest');
    await Promise.resolve();
  });
  expect(result.current.data).toBe('newest');
});
