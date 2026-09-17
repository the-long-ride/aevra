import { readAdminBody, sendAdminResponse } from './http.js';
import type { AdminRouteHandler } from './types.js';

const PATHS = new Set([
  '/api/browser',
  '/api/browser/code',
  '/api/browser/pair',
  '/api/browser/revoke',
  '/api/browser/policy',
]);

export const handleBrowserRoutes: AdminRouteHandler = async (req, res, url, context) => {
  if (!PATHS.has(url.pathname)) return false;
  const method = req.method ?? 'GET';
  const browser = context.browser;
  if (!browser) {
    sendAdminResponse(res, 503, {
      error: { code: 'BROWSER_UNAVAILABLE', message: 'Browser control is unavailable' },
    });
    return true;
  }

  if (url.pathname === '/api/browser' && method === 'GET') {
    sendAdminResponse(res, 200, browser.state());
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
      await browser.redeem(String(input?.code ?? ''), String(input?.extensionId ?? '')),
    );
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
