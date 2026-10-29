import { normalizeYoloPolicy } from '../../../../../packages/protocol/src/index.js';
import { readAdminBody, sendAdminResponse } from './http.js';
import type { AdminRouteHandler } from './types.js';

export const handleYoloPolicyRoutes: AdminRouteHandler = async (req, res, url, context) => {
  if (url.pathname !== '/api/policy/yolo') return false;
  const stored = () =>
    normalizeYoloPolicy(context.settings?.get?.('policy.yolo', { mode: 'workspace' }));
  if (req.method === 'GET') {
    sendAdminResponse(res, 200, stored());
    return true;
  }
  if (req.method === 'PATCH') {
    const input = await readAdminBody(req);
    const current = stored();
    // Merge: an omitted axis keeps its stored value; a present one is normalized.
    const value = normalizeYoloPolicy({
      mode: input && 'mode' in input ? input.mode : current.mode,
      risk: input && 'risk' in input ? input.risk : current.risk,
    });
    context.settings?.set?.('policy.yolo', value);
    context.audit?.append?.({
      actor: 'admin',
      operation: 'policy.yolo.update',
      target: `mode=${value.mode} risk=${value.risk}`,
      result: 'ok',
      redactionCount: 0,
      class: 'normal',
    });
    sendAdminResponse(res, 200, value);
    return true;
  }
  return false;
};
