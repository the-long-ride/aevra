import type { RuntimeHealthStatus } from '@aevra/admin-contracts';
import { useEffect, useState } from 'react';
import { requestJson } from '../services/api-client';

const unavailable: RuntimeHealthStatus = {
  core: 'unavailable',
  worker: 'unavailable',
  mcp: 'unavailable',
  tunnel: 'unavailable',
};

export function useRuntimeStatus(): RuntimeHealthStatus {
  const [status, setStatus] = useState<RuntimeHealthStatus>({});

  useEffect(() => {
    let stopped = false;
    const refresh = async () => {
      try {
        const next = await requestJson<RuntimeHealthStatus>('/api/status');
        if (!stopped) setStatus(next);
      } catch {
        if (!stopped) setStatus(unavailable);
      }
    };

    void refresh();
    const timer = window.setInterval(() => void refresh(), 2000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, []);

  return status;
}
