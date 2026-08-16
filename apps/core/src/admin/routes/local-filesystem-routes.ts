import { sendAdminResponse } from './http.js';
import type { AdminRouteHandler } from './types.js';

export const handleLocalFilesystemRoutes: AdminRouteHandler = async (req, res, url, context) => {
  const method = req.method ?? 'GET';

  if (url.pathname === '/api/local/directories' && method === 'GET') {
    const inputPath = url.searchParams.get('path') ?? '';
    const result = await context.localFilesystem.listDirectories(inputPath);
    sendAdminResponse(res, 200, result);
    return true;
  }

  if (url.pathname === '/api/local/folder-picker' && method === 'POST') {
    const result = await context.localFilesystem.pickServerFolder();
    sendAdminResponse(res, 200, result);
    return true;
  }

  return false;
};
