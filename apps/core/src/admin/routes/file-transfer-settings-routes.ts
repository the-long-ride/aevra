import {
  FILE_TRANSFER_SETTING_KEY,
  normalizeTransferLimits,
} from '../../../../../packages/protocol/src/file-transfer.js';
import { readAdminBody, sendAdminResponse } from './http.js';
import type { AdminRouteHandler } from './types.js';

const PATH = '/api/files/transfer-settings';

export const handleFileTransferSettingsRoutes: AdminRouteHandler = async (
  req,
  res,
  url,
  context,
) => {
  if (url.pathname !== PATH) return false;
  const stored = context.settings?.get?.(FILE_TRANSFER_SETTING_KEY, {});
  const current = normalizeTransferLimits(stored);
  if (req.method === 'GET') {
    sendAdminResponse(res, 200, current);
    return true;
  }
  if (req.method !== 'PATCH') {
    sendAdminResponse(res, 405, {
      error: { code: 'METHOD_NOT_ALLOWED', message: 'Use GET or PATCH.' },
    });
    return true;
  }
  const input = await readAdminBody(req);
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    sendAdminResponse(res, 400, {
      error: { code: 'INVALID_TRANSFER_LIMITS', message: 'Body must be a JSON object.' },
    });
    return true;
  }
  const value = normalizeTransferLimits({ ...current, ...input });
  context.settings?.set?.(FILE_TRANSFER_SETTING_KEY, value);
  sendAdminResponse(res, 200, {
    ok: true,
    revision: context.settings?.revision?.(FILE_TRANSFER_SETTING_KEY) ?? 1,
    value,
  });
  return true;
};
