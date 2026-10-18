import { sendAdminResponse } from './http.js';
import type { AdminRouteHandler } from './types.js';

export const handleSystemRoutes: AdminRouteHandler = async (req, res, url, context) => {
  if (url.pathname !== '/api/system/tunnel-tools' || (req.method ?? 'GET') !== 'GET') {
    return false;
  }
  if (!context.tunnelTools) {
    sendAdminResponse(res, 503, {
      error: { code: 'TUNNEL_DETECTION_UNAVAILABLE', message: 'Tunnel detection is unavailable' },
    });
    return true;
  }
  try {
    sendAdminResponse(res, 200, await context.tunnelTools());
  } catch (error) {
    sendAdminResponse(res, 503, {
      error: {
        code: 'TUNNEL_DETECTION_FAILED',
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
  return true;
};
