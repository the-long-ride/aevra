import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { useControlGrants } from './useControlGrants';

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('a failed initial load clears when the selected connection changes', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url.includes('first')
        ? json({ error: { message: 'Connection unavailable' } }, 503)
        : json({ connectionId: 'second', browser: false, desktop: false }),
    ),
  );
  const onChanged = vi.fn().mockResolvedValue(undefined);
  const { result, rerender } = renderHook(({ base }) => useControlGrants(base, onChanged), {
    initialProps: { base: '/api/connections/first/control' },
  });
  await waitFor(() => expect(result.current.loadError).toBe('Connection unavailable'));
  rerender({ base: '/api/connections/second/control' });
  await waitFor(() => expect(result.current.grants?.connectionId).toBe('second'));
  expect(result.current.loadError).toBe('');
});

test('a failed revoke and failed refresh show both errors and unlock retry', async () => {
  let reads = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE')
        return json({ error: { message: 'Worker invalidation failed' } }, 503);
      reads += 1;
      return reads === 1
        ? json({ connectionId: 'one', browser: true, desktop: false })
        : json({ error: { message: 'Refresh unavailable' } }, 503);
    }),
  );
  const onChanged = vi.fn().mockResolvedValue(undefined);
  const { result } = renderHook(() => useControlGrants('/api/connections/one/control', onChanged));
  await waitFor(() => expect(result.current.grants?.browser).toBe(true));
  await act(async () => result.current.setGrant('browser.control', false));
  expect(result.current.actionError).toContain('Worker invalidation failed');
  expect(result.current.actionError).toContain('Refresh unavailable');
  expect(result.current.busy).toBeNull();
  expect(onChanged).not.toHaveBeenCalled();
});

test('a second action cannot run while the first grant mutation is pending', async () => {
  let finish!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => (finish = resolve));
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
    init?.method === 'POST'
      ? pending
      : json({ connectionId: 'one', browser: false, desktop: false }),
  );
  vi.stubGlobal('fetch', fetchMock);
  const { result } = renderHook(() =>
    useControlGrants('/api/connections/one/control', vi.fn().mockResolvedValue(undefined)),
  );
  await waitFor(() => expect(result.current.grants).not.toBeNull());
  let first!: Promise<void>;
  act(() => {
    first = result.current.setGrant('browser.control', true);
  });
  expect(result.current.busy).toBe('browser.control');
  await act(async () => result.current.setGrant('desktop.control', true));
  expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  finish(json({}));
  await act(async () => first);
  expect(result.current.busy).toBeNull();
});

test('a notification failure refreshes persisted state and remains visible', async () => {
  let browser = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') browser = true;
      return json(init?.method === 'POST' ? {} : { connectionId: 'one', browser, desktop: false });
    }),
  );
  const onChanged = vi
    .fn()
    .mockRejectedValueOnce(new Error('Dashboard refresh failed'))
    .mockResolvedValue(undefined);
  const { result } = renderHook(() => useControlGrants('/api/connections/one/control', onChanged));
  await waitFor(() => expect(result.current.grants?.browser).toBe(false));
  await act(async () => result.current.setGrant('browser.control', true));
  expect(result.current.grants?.browser).toBe(true);
  expect(result.current.actionError).toBe('Dashboard refresh failed');
  expect(onChanged).toHaveBeenCalledTimes(2);
});
