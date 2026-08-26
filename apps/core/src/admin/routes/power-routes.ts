import { isKeepAwakeMode } from '../../power/keep-awake-service.js';
import { readAdminBody, sendAdminResponse } from './http.js';
import type { AdminRouteHandler } from './types.js';

export const handlePowerRoutes: AdminRouteHandler = async (req, res, url, context) => {
  if (url.pathname !== '/api/power/keep-awake') return false;
  const method = req.method ?? 'GET';

  if (!context.power) {
    sendAdminResponse(res, 503, {
      error: { code: 'POWER_SERVICE_UNAVAILABLE', message: 'Keep awake service is unavailable' },
    });
    return true;
  }

  if (method === 'GET') {
    sendAdminResponse(res, 200, context.power.status());
    return true;
  }

  if (method === 'PATCH') {
    const input = await readAdminBody(req);
    if (!isKeepAwakeMode(input?.mode)) {
      sendAdminResponse(res, 400, {
        error: {
          code: 'INVALID_KEEP_AWAKE_MODE',
          message: 'Keep awake mode must be off, remote-connections, managed-processes, or always',
        },
      });
      return true;
    }
    sendAdminResponse(res, 200, await context.power.configure(input.mode));
    return true;
  }

  return false;
};
