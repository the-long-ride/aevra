import { normalizeYoloMode } from '../../../../../packages/protocol/src/index.js';
import { readAdminBody, sendAdminResponse } from './http.js';
import type { AdminRouteHandler } from './types.js';

export const handleYoloPolicyRoutes: AdminRouteHandler = async (req, res, url, context) => {
  if (url.pathname !== '/api/policy/yolo') return false;
  if (req.method === 'GET') {
    sendAdminResponse(res, 200, {
      mode: normalizeYoloMode(context.settings?.get?.('policy.yolo', { mode: 'workspace' })?.mode),
    });
    return true;
  }
  if (req.method === 'PATCH') {
    const input = await readAdminBody(req);
    const value = { mode: normalizeYoloMode(input?.mode) };
    context.settings?.set?.('policy.yolo', value);
    sendAdminResponse(res, 200, value);
    return true;
  }
  return false;
};
