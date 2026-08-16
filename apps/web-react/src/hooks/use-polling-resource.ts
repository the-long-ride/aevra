import { useCallback, useEffect, useRef, useState } from 'react';

export interface PollingResourceOptions<T> {
  load(signal: AbortSignal): Promise<T>;
  intervalMs?: number;
  enabled?: boolean;
}

export interface PollingResource<T> {
  data: T | null;
  error: Error | null;
  loading: boolean;
  refresh(): Promise<void>;
}

export function usePollingResource<T>({
  load,
  intervalMs = 0,
  enabled = true,
}: PollingResourceOptions<T>): PollingResource<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(enabled);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const hasData = useRef(false);

  const invalidate = useCallback(() => {
    generation.current += 1;
    controller.current?.abort();
    controller.current = null;
  }, []);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    const currentGeneration = ++generation.current;
    controller.current?.abort();
    const nextController = new AbortController();
    controller.current = nextController;
    if (!hasData.current) setLoading(true);

    try {
      const value = await load(nextController.signal);
      if (!nextController.signal.aborted && currentGeneration === generation.current) {
        hasData.current = true;
        setData(value);
        setError(null);
      }
    } catch (cause) {
      if (!nextController.signal.aborted && currentGeneration === generation.current) {
        setError(cause instanceof Error ? cause : new Error(String(cause)));
      }
    } finally {
      if (currentGeneration === generation.current) setLoading(false);
    }
  }, [enabled, load]);

  useEffect(() => {
    if (!enabled) {
      invalidate();
      setLoading(false);
      return undefined;
    }

    void refresh();
    if (intervalMs <= 0) {
      return invalidate;
    }

    const timer = window.setInterval(() => void refresh(), intervalMs);
    return () => {
      window.clearInterval(timer);
      invalidate();
    };
  }, [enabled, intervalMs, invalidate, refresh]);

  return { data, error, loading, refresh };
}
