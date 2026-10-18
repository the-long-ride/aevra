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

/** A timer tick never aborts a young request; only one stuck this long is replaced. */
const MIN_STALE_MS = 30_000;

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
  const startedAt = useRef<number | null>(null);
  const loadedWith = useRef<PollingResourceOptions<T>['load'] | null>(null);

  const invalidate = useCallback(() => {
    generation.current += 1;
    controller.current?.abort();
    controller.current = null;
    startedAt.current = null;
  }, []);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    const currentGeneration = ++generation.current;
    controller.current?.abort();
    const nextController = new AbortController();
    controller.current = nextController;
    startedAt.current = Date.now();
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
      if (currentGeneration === generation.current) {
        startedAt.current = null;
        setLoading(false);
      }
    }
  }, [enabled, load]);

  useEffect(() => {
    if (!enabled) {
      invalidate();
      setLoading(false);
      return undefined;
    }

    // A different `load` is a different resource: do not show the old one's data as current.
    if (loadedWith.current !== load) {
      if (loadedWith.current !== null) {
        hasData.current = false;
        setData(null);
        setError(null);
      }
      loadedWith.current = load;
    }

    void refresh();
    if (intervalMs <= 0) {
      return invalidate;
    }

    const staleMs = Math.max(MIN_STALE_MS, intervalMs * 5);
    const timer = window.setInterval(() => {
      const started = startedAt.current;
      if (started !== null && Date.now() - started < staleMs) return;
      void refresh();
    }, intervalMs);
    return () => {
      window.clearInterval(timer);
      invalidate();
    };
  }, [enabled, intervalMs, invalidate, load, refresh]);

  return { data, error, loading, refresh };
}
