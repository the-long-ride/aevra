import type { TokenUsageRange } from '@aevra/admin-contracts';
import { useCallback } from 'react';
import { fetchTokenUsage } from '../services/token-usage-service';
import { usePollingResource } from './use-polling-resource';

const POLL_MS = 15_000;

/** Polls the token usage report; a new range reloads because `load` changes with it. */
export function useTokenUsage(range: TokenUsageRange) {
  const load = useCallback((signal: AbortSignal) => fetchTokenUsage(range, signal), [range]);
  return usePollingResource({ load, intervalMs: POLL_MS, enabled: true });
}
