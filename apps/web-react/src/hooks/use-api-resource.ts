import { useCallback, useEffect, useRef, useState } from 'react';

export interface ApiResource<T> {
  data: T | null;
  error: Error | null;
  loading: boolean;
  refresh(): Promise<void>;
}

export function useApiResource<T>(
  load: (signal: AbortSignal) => Promise<T>,
): ApiResource<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const controller = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    controller.current?.abort();
    const next = new AbortController();
    controller.current = next;
    setLoading(true);
    try {
      const value = await load(next.signal);
      if (!next.signal.aborted) {
        setData(value);
        setError(null);
      }
    } catch (cause) {
      if (!next.signal.aborted) {
        setError(cause instanceof Error ? cause : new Error(String(cause)));
      }
    } finally {
      if (!next.signal.aborted) setLoading(false);
    }
  }, [load]);

  useEffect(() => {
    void refresh();
    return () => controller.current?.abort();
  }, [refresh]);

  return { data, error, loading, refresh };
}
