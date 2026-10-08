import type { TokenUsageRange, TokenUsageReport } from '@aevra/admin-contracts';
import { requestJson } from './api-client';

export function fetchTokenUsage(
  range: TokenUsageRange,
  signal?: AbortSignal,
): Promise<TokenUsageReport> {
  return requestJson<TokenUsageReport>(
    `/api/usage/tokens?range=${range}`,
    signal ? { signal } : {},
  );
}
