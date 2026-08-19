import type { RuntimeHealthStatus } from '@aevra/admin-contracts';
import { requestJson } from '../services/api-client';
import { usePollingResource } from './use-polling-resource';

const unavailable: RuntimeHealthStatus = {
  core: 'unavailable',
  worker: 'unavailable',
  mcp: 'unavailable',
  tunnel: 'unavailable',
};

function loadRuntimeStatus(signal: AbortSignal) {
  return requestJson<RuntimeHealthStatus>('/api/status', { signal });
}

export function useRuntimeStatus(): RuntimeHealthStatus {
  const resource = usePollingResource({
    load: loadRuntimeStatus,
    intervalMs: 2000,
  });

  if (resource.data) return resource.data;
  return resource.error ? unavailable : {};
}
