import { readAdminBody, sendAdminResponse } from './http.js';
import type { AdminRouteHandler } from './types.js';

const PATHS = new Set([
  '/api/browser',
  '/api/browser/code',
  '/api/browser/pair',
  '/api/browser/revoke',
  '/api/browser/policy',
]);

function pairingIdFromPath(pathname: string): string | null {
  const match = /^\/api\/browser\/pairings\/([^/]+)$/.exec(pathname);
  if (!match) return null;
  try {
    const pairingId = decodeURIComponent(match[1]!);
    return pairingId && !pairingId.includes('/') ? pairingId : null;
  } catch {
    return null;
  }
}

export const handleBrowserRoutes: AdminRouteHandler = async (req, res, url, context) => {
  const pairingId = pairingIdFromPath(url.pathname);
  if (!PATHS.has(url.pathname) && pairingId === null) return false;
  const method = req.method ?? 'GET';
  const browser = context.browser;
  if (!browser) {
    sendAdminResponse(res, 503, {
      error: { code: 'BROWSER_UNAVAILABLE', message: 'Browser control is unavailable' },
    });
    return true;
  }

  if (url.pathname === '/api/browser' && method === 'GET') {
    const health = await browser.pairingHealth();
    sendAdminResponse(res, 200, { ...browser.state(health), health });
    return true;
  }
  if (url.pathname === '/api/browser/code' && method === 'POST') {
    sendAdminResponse(res, 200, browser.createCode());
    return true;
  }
  if (url.pathname === '/api/browser/pair' && method === 'POST') {
    const input = await readAdminBody(req);
    sendAdminResponse(
      res,
      200,
      await browser.redeem({
        code: String(input?.code ?? ''),
        extensionId: String(input?.extensionId ?? ''),
        profileId: String(input?.profileId ?? ''),
        profileName: String(input?.profileName ?? ''),
      }),
    );
    return true;
  }
  if (pairingId && method === 'DELETE') {
    try {
      sendAdminResponse(res, 200, await browser.unpair(pairingId));
    } catch (cause) {
      const error = cause as { code?: string; message?: string; status?: number };
      sendAdminResponse(res, error.status ?? 500, {
        error: {
          code: error.code ?? 'BROWSER_PAIRING_REMOVE_FAILED',
          message: error.message ?? 'Browser pairing could not be removed',
        },
      });
    }
    return true;
  }
  if (url.pathname === '/api/browser/revoke' && method === 'POST') {
    sendAdminResponse(res, 200, await browser.revokeAll());
    return true;
  }
  if (url.pathname === '/api/browser/policy' && method === 'GET') {
    sendAdminResponse(res, 200, context.browserPolicy?.snapshot() ?? null);
    return true;
  }
  if (url.pathname === '/api/browser/policy' && method === 'POST') {
    const input = await readAdminBody(req);
    if (!context.browserPolicy) {
      sendAdminResponse(res, 503, {
        error: { code: 'BROWSER_UNAVAILABLE', message: 'Browser control is unavailable' },
      });
      return true;
    }
    try {
      context.browserPolicy.update(input ?? {});
      sendAdminResponse(res, 200, context.browserPolicy.snapshot());
    } catch (cause) {
      const error = cause as { code?: string; message?: string };
      sendAdminResponse(res, 400, {
        error: {
          code: error.code ?? 'ORIGIN_POLICY_INVALID',
          message: error.message ?? 'Invalid origin policy',
        },
      });
    }
    return true;
  }
  return false;
};
