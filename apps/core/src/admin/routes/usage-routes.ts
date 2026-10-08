import type { TokenUsageRange } from '../../../../../packages/admin-contracts/src/token-usage.js';
import { sendAdminResponse } from './http.js';
import type { AdminRouteHandler } from './types.js';

const RANGES: readonly TokenUsageRange[] = ['24h', '7d', '30d', '90d', 'all'];

function reject(
  res: Parameters<AdminRouteHandler>[1],
  status: number,
  code: string,
  message: string,
) {
  sendAdminResponse(res, status, { error: { code, message } });
}

export const handleUsageRoutes: AdminRouteHandler = (req, res, url, context) => {
  if (url.pathname !== '/api/usage/tokens') return false;
  if (req.method !== 'GET') {
    reject(res, 405, 'METHOD_NOT_ALLOWED', 'Use GET.');
    return true;
  }
  if (!context.usage) {
    reject(res, 503, 'USAGE_UNAVAILABLE', 'Token usage is not available.');
    return true;
  }
  const range = (url.searchParams.get('range') ?? '24h') as TokenUsageRange;
  if (!RANGES.includes(range)) {
    reject(res, 400, 'INVALID_RANGE', `range must be one of ${RANGES.join(', ')}.`);
    return true;
  }
  sendAdminResponse(res, 200, context.usage.report(range));
  return true;
};
