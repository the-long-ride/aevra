import { scanDesktopApps } from '../../../../../packages/desktop/src/app-catalog.js';
import type { DesktopPolicyService } from '../../desktop/desktop-policy-service.js';
import { readAdminBody, sendAdminResponse } from './http.js';
import type { AdminRouteHandler } from './types.js';

const PATHS = new Set([
  '/api/desktop/policy',
  '/api/desktop/apps',
  '/api/desktop/custom-apps',
  '/api/desktop/app-grants',
]);
const ACCESS_REQUESTS_PATH = '/api/desktop/access-requests';
const APP_GRANTS_PATH = '/api/desktop/app-grants';

export const handleDesktopRoutes: AdminRouteHandler = async (req, res, url, context) => {
  const requestDecision = url.pathname.match(/^\/api\/desktop\/access-requests\/([^/]+)\/(approve|deny)$/);
  const grantRevocation = url.pathname.match(/^\/api\/desktop\/app-grants\/([^/]+)$/);
  const customAppDeletion = url.pathname.match(/^\/api\/desktop\/custom-apps\/([^/]+)$/);
  if (
    !PATHS.has(url.pathname) &&
    url.pathname !== ACCESS_REQUESTS_PATH &&
    !requestDecision &&
    !grantRevocation &&
    !customAppDeletion
  ) return false;
  const method = req.method ?? 'GET';

  // Detection is a stateless OS inventory read with no dependency on policy
  // service, so this stays available even in contexts (tests, a core built
  // without desktop control wired) that have nothing else desktop-related.
  if (url.pathname === '/api/desktop/apps' && method === 'GET') {
    sendAdminResponse(
      res,
      200,
      context.desktopAppCatalog ? await context.desktopAppCatalog.list() : await scanDesktopApps(),
    );
    return true;
  }

  if (url.pathname === '/api/desktop/custom-apps' && method === 'PUT') {
    if (!context.desktopAppCatalog) {
      sendAdminResponse(res, 503, { error: { code: 'DESKTOP_UNAVAILABLE', message: 'Desktop app catalog is unavailable' } });
      return true;
    }
    sendAdminResponse(res, 200, { app: await context.desktopAppCatalog.saveCustom(await readAdminBody(req)) });
    return true;
  }
  if (customAppDeletion && method === 'DELETE') {
    if (!context.desktopAppCatalog) {
      sendAdminResponse(res, 503, { error: { code: 'DESKTOP_UNAVAILABLE', message: 'Desktop app catalog is unavailable' } });
      return true;
    }
    sendAdminResponse(res, 200, {
      app: context.desktopAppCatalog.deleteCustom(decodeURIComponent(customAppDeletion[1]!), 'admin'),
    });
    return true;
  }

  if (url.pathname === ACCESS_REQUESTS_PATH && method === 'GET') {
    const desktopAccess = context.desktopAccess;
    if (!desktopAccess) {
      sendAdminResponse(res, 503, { error: { code: 'DESKTOP_UNAVAILABLE', message: 'Desktop access review is unavailable' } });
      return true;
    }
    sendAdminResponse(res, 200, { requests: desktopAccess.listPending() });
    return true;
  }
  if (requestDecision && method === 'POST') {
    const desktopAccess = context.desktopAccess;
    if (!desktopAccess) {
      sendAdminResponse(res, 503, { error: { code: 'DESKTOP_UNAVAILABLE', message: 'Desktop access review is unavailable' } });
      return true;
    }
    const requestId = decodeURIComponent(requestDecision[1]!);
    if (requestDecision[2] === 'approve') {
      const body = await readAdminBody(req);
      sendAdminResponse(res, 200, await desktopAccess.approve(requestId, body.scope, 'admin'));
    } else {
      sendAdminResponse(res, 200, desktopAccess.deny(requestId, 'admin'));
    }
    return true;
  }
  if (url.pathname === APP_GRANTS_PATH && method === 'GET') {
    const desktopAccess = context.desktopAccess;
    if (!desktopAccess) {
      sendAdminResponse(res, 503, { error: { code: 'DESKTOP_UNAVAILABLE', message: 'Desktop grants are unavailable' } });
      return true;
    }
    sendAdminResponse(res, 200, { grants: desktopAccess.listGrants() });
    return true;
  }
  if (url.pathname === APP_GRANTS_PATH && method === 'POST') {
    if (!context.desktopAppCatalog) {
      sendAdminResponse(res, 503, { error: { code: 'DESKTOP_UNAVAILABLE', message: 'Desktop app catalog is unavailable' } });
      return true;
    }
    sendAdminResponse(res, 200, {
      grant: await context.desktopAppCatalog.grant(await readAdminBody(req), 'admin'),
    });
    return true;
  }
  if (grantRevocation && method === 'DELETE') {
    const desktopAccess = context.desktopAccess;
    if (!desktopAccess) {
      sendAdminResponse(res, 503, { error: { code: 'DESKTOP_UNAVAILABLE', message: 'Desktop grants are unavailable' } });
      return true;
    }
    sendAdminResponse(res, 200, desktopAccess.revokeGrant(decodeURIComponent(grantRevocation[1]!), 'admin'));
    return true;
  }

  const desktopPolicy = context.desktopPolicy as DesktopPolicyService | undefined;
  if (!desktopPolicy) {
    sendAdminResponse(res, 503, {
      error: { code: 'DESKTOP_UNAVAILABLE', message: 'Desktop policy is unavailable' },
    });
    return true;
  }
  if (url.pathname === '/api/desktop/policy' && method === 'GET') {
    sendAdminResponse(res, 200, desktopPolicy.snapshot());
    return true;
  }
  if (url.pathname === '/api/desktop/policy' && method === 'POST') {
    const input = await readAdminBody(req);
    try {
      sendAdminResponse(res, 200, desktopPolicy.update(input ?? {}));
    } catch (cause) {
      const error = cause as { code?: string; message?: string };
      sendAdminResponse(res, 400, {
        error: {
          code: error.code ?? 'DESKTOP_POLICY_INVALID',
          message: error.message ?? 'Invalid desktop policy',
        },
      });
    }
    return true;
  }
  return false;
};
