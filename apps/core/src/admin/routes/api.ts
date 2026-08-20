import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleAccessRoutes } from './access-routes.js';
import { handleActivityRoutes } from './activity-routes.js';
import { handleApprovalPermissionRoutes } from './approval-permission-routes.js';
import { sendAdminResponse } from './http.js';
import { handleOperationRoutes } from './operation-routes.js';
import { handleSessionConnectorRoutes } from './session-connector-routes.js';
import { handleSettingsRoutes } from './settings-routes.js';
import type { AdminApiContext, AdminRouteHandler } from './types.js';
import { handleWorkspaceRoutes } from './workspace-routes.js';

export type { AdminApiContext } from './types.js';

const handlers: AdminRouteHandler[] = [
  handleActivityRoutes,
  handleWorkspaceRoutes,
  handleApprovalPermissionRoutes,
  handleSessionConnectorRoutes,
  handleOperationRoutes,
  handleSettingsRoutes,
  handleAccessRoutes,
];

export async function handleAdminApi(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  context: AdminApiContext,
): Promise<boolean> {
  const path = url.pathname;
  const method = req.method ?? 'GET';

  try {
    if (
      context.safeMode?.() &&
      !['GET', 'HEAD', 'OPTIONS'].includes(method) &&
      !path.startsWith('/api/config/')
    ) {
      sendAdminResponse(res, 503, {
        error: {
          code: 'SAFE_MODE',
          message: 'Administrative mutations are disabled while Aevra is in safe mode',
        },
      });
      return true;
    }

    for (const handler of handlers) {
      if (await handler(req, res, url, context)) return true;
    }
    return false;
  } catch (error) {
    const failure = error as any;
    sendAdminResponse(res, failure.status ?? 400, {
      error: {
        code: failure.code ?? 'ADMIN_REQUEST_FAILED',
        message: error instanceof Error ? error.message : String(error),
      },
    });
    return true;
  }
}
