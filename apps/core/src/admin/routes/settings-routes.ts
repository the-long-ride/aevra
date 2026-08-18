import { randomUUID } from 'node:crypto';
import { readAdminBody, sendAdminResponse } from './http.js';
import {
  DEFAULT_ONBOARDING,
  GUIDE_CHAPTERS,
  onboardingState,
  revision,
} from './route-state.js';
import type { AdminRouteHandler } from './types.js';

export const handleSettingsRoutes: AdminRouteHandler = async (
  req,
  res,
  url,
  context,
) => {
  const path = url.pathname;
  const method = req.method ?? 'GET';

  if (path === '/api/policy/command-families' && method === 'GET') {
    sendAdminResponse(
      res,
      200,
      context.settings?.get?.('command.family.overrides', {}) ?? {},
    );
    return true;
  }

  if (path === '/api/policy/command-families' && method === 'PATCH') {
    const input = await readAdminBody(req);
    context.settings?.set?.('command.family.overrides', input);
    sendAdminResponse(res, 200, {
      ok: true,
      revision: context.settings?.revision?.('command.family.overrides') ?? 1,
    });
    return true;
  }

  if (path === '/api/policy/network-rules' && method === 'GET') {
    sendAdminResponse(
      res,
      200,
      context.settings?.get?.('network.rules', []) ?? [],
    );
    return true;
  }

  if (path === '/api/policy/network-rules' && method === 'POST') {
    const input = await readAdminBody(req);
    const rules = context.settings?.get?.('network.rules', []) ?? [];
    const host = String(input.host ?? '').toLowerCase();
    if (!host || host.includes('*')) {
      sendAdminResponse(res, 400, {
        error: {
          code: 'INVALID_NETWORK_RULE',
          message:
            'Network rule host must be explicit; wildcard hosts belong in the advanced permission editor',
        },
      });
      return true;
    }

    const protocol = String(input.protocol ?? 'https')
      .replace(':', '')
      .toLowerCase();
    const port = Number(input.port ?? 443);
    const rule = {
      id: input.id ?? `net_${randomUUID()}`,
      effect: input.effect === 'deny' ? 'deny' : 'allow',
      protocol,
      host,
      port,
      workspaceId: input.workspaceId ?? null,
    };
    rules.push(rule);
    context.settings?.set?.('network.rules', rules);
    context.permissions?.upsert?.({
      id: `perm_${rule.id}`,
      effect: rule.effect,
      capability: 'network',
      scope: rule.workspaceId ? 'workspace' : 'global',
      workspaceId: rule.workspaceId ?? undefined,
      matcher: `network.host:${protocol}:${host}:${port}`,
      createdAt: new Date().toISOString(),
    });
    sendAdminResponse(res, 200, {
      ok: true,
      revision: context.settings?.revision?.('network.rules') ?? 1,
      rule,
    });
    return true;
  }

  let match = path.match(/^\/api\/policy\/network-rules\/([^/]+)$/);
  if (match && method === 'DELETE') {
    const rules = (context.settings?.get?.('network.rules', []) ?? []).filter(
      (rule: any) => rule.id !== match[1],
    );
    context.settings?.set?.('network.rules', rules);
    context.permissions?.delete?.(`perm_${match[1]}`);
    sendAdminResponse(res, 200, {
      ok: true,
      revision: context.settings?.revision?.('network.rules') ?? 1,
    });
    return true;
  }

  if (path === '/api/execution-settings' && method === 'GET') {
    sendAdminResponse(
      res,
      200,
      context.settings?.get?.('execution.settings', {
        sandboxBackend: 'auto',
        cachePolicy: 'workspace',
        workspaceDrainMs: 60000,
      }) ?? {},
    );
    return true;
  }

  if (path === '/api/execution-settings' && method === 'PATCH') {
    const input = await readAdminBody(req);
    context.settings?.set?.('execution.settings', input);
    if (input.workspaceDrainMs) {
      context.settings?.set?.(
        'workspace.drain.defaultMs',
        Number(input.workspaceDrainMs),
      );
    }
    sendAdminResponse(res, 200, {
      ok: true,
      revision: context.settings?.revision?.('execution.settings') ?? 1,
    });
    return true;
  }

  if (path === '/api/settings' && method === 'GET') {
    sendAdminResponse(
      res,
      200,
      context.settings?.get?.('admin.settings', {}) ?? {},
    );
    return true;
  }

  if (path === '/api/settings' && method === 'PATCH') {
    const input = await readAdminBody(req);
    const expected = Number(req.headers['if-match'] ?? input.revision ?? -1);
    const current = revision(context, 'admin.settings');
    if (expected >= 0 && expected !== current) {
      sendAdminResponse(res, 409, {
        error: { code: 'STALE_REVISION', current },
      });
      return true;
    }
    context.settings?.set?.('admin.settings', input.value ?? input);
    sendAdminResponse(res, 200, {
      ok: true,
      revision: revision(context, 'admin.settings'),
    });
    return true;
  }

  if (path === '/api/onboarding' && method === 'GET') {
    sendAdminResponse(
      res,
      200,
      onboardingState(
        context.settings?.get?.('onboarding.state', DEFAULT_ONBOARDING) ??
          DEFAULT_ONBOARDING,
      ),
    );
    return true;
  }

  if (path === '/api/onboarding' && method === 'PATCH') {
    const state = onboardingState(await readAdminBody(req));
    context.settings?.set?.('onboarding.state', state);
    sendAdminResponse(res, 200, {
      ok: true,
      revision: revision(context, 'onboarding.state'),
      state,
    });
    return true;
  }

  if (path === '/api/guide' && method === 'GET') {
    sendAdminResponse(res, 200, GUIDE_CHAPTERS);
    return true;
  }

  return false;
};
