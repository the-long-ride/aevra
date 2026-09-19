import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useApiResource } from './use-api-resource';

describe('useApiResource', () => {
  it('loads data successfully and handles refresh', async () => {
    let callCount = 0;
    const loader = vi.fn().mockImplementation(async () => {
      callCount++;
      return { count: callCount };
    });

    const { result } = renderHook(() => useApiResource(loader));
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual({ count: 1 });
    expect(result.current.error).toBeNull();

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.data).toEqual({ count: 2 });
  });

  it('captures Error and string causes when loader rejects', async () => {
    const errorLoader = vi.fn().mockRejectedValue(new Error('fetch failed'));
    const { result, rerender } = renderHook(({ fn }) => useApiResource(fn), {
      initialProps: { fn: errorLoader },
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error?.message).toBe('fetch failed');

    // String cause
    const stringErrorLoader = vi.fn().mockRejectedValue('string rejection');
    rerender({ fn: stringErrorLoader });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error?.message).toBe('string rejection');
  });

  it('aborts previous call on refresh or unmount', async () => {
    let capturedSignal: AbortSignal | undefined;
    const pendingLoader = vi.fn().mockImplementation((signal: AbortSignal) => {
      capturedSignal = signal;
      return new Promise(() => {});
    });

    const { unmount } = renderHook(() => useApiResource(pendingLoader));
    await waitFor(() => expect(pendingLoader).toHaveBeenCalled());

    expect(capturedSignal?.aborted).toBe(false);
    unmount();
    expect(capturedSignal?.aborted).toBe(true);
  });
});
