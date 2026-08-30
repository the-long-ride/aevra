import { readAdminBody, sendAdminResponse } from './http.js';
import type { AdminRouteHandler } from './types.js';

type YoloMode = 'workspace' | 'unrestricted';

function mode(value: unknown): YoloMode {
  return value === 'unrestricted' ? 'unrestricted' : 'workspace';
}

export const handleYoloPolicyRoutes: AdminRouteHandler = async (req, res, url, context) => {
  if (url.pathname !== '/api/policy/yolo') return false;
  if (req.method === 'GET') {
    sendAdminResponse(res, 200, {
      mode: mode(context.settings?.get?.('policy.yolo', { mode: 'workspace' })?.mode),
    });
    return true;
  }
  if (req.method === 'PATCH') {
    const input = await readAdminBody(req);
    const value = { mode: mode(input?.mode) };
    context.settings?.set?.('policy.yolo', value);
    sendAdminResponse(res, 200, value);
    return true;
  }
  return false;
};
