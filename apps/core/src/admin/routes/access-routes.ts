import { readAdminBody, sendAdminResponse } from './http.js';
import type { AdminRouteHandler } from './types.js';

export const handleAccessRoutes: AdminRouteHandler = async (
  req,
  res,
  url,
  context,
) => {
  const path = url.pathname;
  const method = req.method ?? 'GET';

  if (path === '/api/oauth/clients' && method === 'GET') {
    sendAdminResponse(res, 200, context.oauth?.listClients?.() ?? []);
    return true;
  }

  if (path === '/api/oauth/requests' && method === 'GET') {
    sendAdminResponse(
      res,
      200,
      context.oauth?.listPendingAuthorizations?.() ?? [],
    );
    return true;
  }

  let match = path.match(
    /^\/api\/oauth\/requests\/([^/]+)\/(approve|deny)$/,
  );
  if (match && method === 'POST') {
    const id = decodeURIComponent(match[1]);
    const decision = match[2];
    const value =
      decision === 'approve'
        ? context.oauth?.approveAuthorization?.(id)
        : context.oauth?.denyAuthorization?.(id);
    if (!value) {
      sendAdminResponse(res, 404, {
        error: {
          code: 'OAUTH_REQUEST_NOT_FOUND',
          message: 'OAuth authorization request not found',
        },
      });
      return true;
    }
    context.audit?.append?.({
      actor: 'admin',
      operation: `oauth.authorize.${decision}`,
      target: id,
      result: 'ok',
      redactionCount: 0,
      class: 'security',
    });
    sendAdminResponse(res, 200, { ok: true, request: value });
    return true;
  }

  if (path === '/api/cloudflare/status' && method === 'GET') {
    const detected = await context.cloudflare?.detectCloudflared?.();
    const auth = await context.cloudflare?.authenticationStatus?.();
    const config = context.settings?.get?.('cloudflare.config', null);
    const authMode =
      config?.authMode ??
      (config?.issuer && config?.audience ? 'access' : 'connector');
    sendAdminResponse(res, 200, {
      ...(detected ?? { found: false }),
      authenticated: auth?.authenticated ?? false,
      authenticationMessage:
        auth?.message ?? 'Cloudflare authentication has not been checked',
      ownership: context.cloudflare?.ownership?.() ?? 'managed',
      authMode,
      ...(config ?? {}),
    });
    return true;
  }

  if (path === '/api/cloudflare/authenticate' && method === 'POST') {
    const result = await context.cloudflare?.authenticate?.();
    if (!result || result.code !== 0) {
      throw Object.assign(
        new Error(
          `cloudflared login failed: ${result?.stderr || result?.stdout || 'unknown error'}`,
        ),
        { status: 400 },
      );
    }
    sendAdminResponse(res, 200, {
      ok: true,
      message:
        result.stdout || result.stderr || 'Cloudflare authentication completed',
    });
    return true;
  }

  if (path === '/api/cloudflare/setup' && method === 'POST') {
    const result = await context.cloudflare.setup(await readAdminBody(req));
    if (result?.hostname) {
      context.oauth?.setPublicBaseUrl?.(`https://${result.hostname}`);
    }
    if (result?.ownership === 'managed') {
      await context.cloudflare?.startManagedTunnel?.();
    }
    sendAdminResponse(res, 200, {
      ok: true,
      revision: Date.now(),
      result,
    });
    return true;
  }

  if (path === '/api/cloudflare/test' && method === 'POST') {
    sendAdminResponse(
      res,
      200,
      (await context.cloudflare?.checkReachability?.()) ?? {
        reachable: false,
        message: 'Cloudflare manager unavailable',
      },
    );
    return true;
  }

  if (path === '/api/secret-references' && method === 'GET') {
    sendAdminResponse(res, 200, context.environment?.listSecretRefs?.() ?? []);
    return true;
  }

  if (path === '/api/secret-references' && method === 'POST') {
    const input = await readAdminBody(req);
    const result = await context.environment?.setSecret?.(
      String(input.ref),
      String(input.value),
      'selected',
    );
    sendAdminResponse(res, 200, {
      ok: true,
      revision: Date.now(),
      secret: { ...result, value: undefined },
    });
    return true;
  }

  match = path.match(/^\/api\/secret-references\/([^/]+)$/);
  if (match && method === 'DELETE') {
    await context.environment?.deleteSecret?.(decodeURIComponent(match[1]));
    sendAdminResponse(res, 200, { ok: true, revision: Date.now() });
    return true;
  }

  if (path === '/api/environment-profiles' && method === 'GET') {
    sendAdminResponse(res, 200, context.environment?.list?.() ?? []);
    return true;
  }

  if (path === '/api/environment-profiles' && method === 'POST') {
    const input = await readAdminBody(req);
    const profile = context.environment.create(
      String(input.name),
      input.vars ?? {},
      input.secretRefs ?? {},
    );
    sendAdminResponse(res, 200, {
      ok: true,
      revision: Date.now(),
      profile,
    });
    return true;
  }

  if (path === '/api/vault/unlock' && method === 'POST') {
    const input = await readAdminBody(req);
    context.vault?.unlock?.(String(input.passphrase ?? ''));
    sendAdminResponse(res, 200, { ok: true, revision: Date.now() });
    return true;
  }

  if (path === '/api/vault/lock' && method === 'POST') {
    context.vault?.lock?.();
    sendAdminResponse(res, 200, { ok: true, revision: Date.now() });
    return true;
  }

  if (path === '/api/config/export' && method === 'GET') {
    sendAdminResponse(
      res,
      200,
      context.database?.configExport?.(
        url.searchParams.get('portable') === '1',
      ) ?? {},
    );
    return true;
  }

  if (path === '/api/config/import-preview' && method === 'POST') {
    const input = await readAdminBody(req);
    sendAdminResponse(
      res,
      200,
      context.database?.configPreview?.(input) ?? {
        adds: 0,
        changes: 0,
        pathRemaps: 0,
        secretReconnects: 0,
      },
    );
    return true;
  }

  return false;
};
