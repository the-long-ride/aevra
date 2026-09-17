import { detectInstalledApps } from '../../../../../packages/desktop/src/installed-apps.js';
import type { DesktopPolicyService } from '../../desktop/desktop-policy-service.js';
import { readAdminBody, sendAdminResponse } from './http.js';
import type { AdminRouteHandler } from './types.js';

const PATHS = new Set(['/api/desktop/policy', '/api/desktop/apps']);

export const handleDesktopRoutes: AdminRouteHandler = async (req, res, url, context) => {
  if (!PATHS.has(url.pathname)) return false;
  const method = req.method ?? 'GET';

  // Detection is a stateless registry read with no dependency on the policy
  // service, so this stays available even in contexts (tests, a core built
  // without desktop control wired) that have nothing else desktop-related.
  if (url.pathname === '/api/desktop/apps' && method === 'GET') {
    sendAdminResponse(res, 200, { apps: await detectInstalledApps() });
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
