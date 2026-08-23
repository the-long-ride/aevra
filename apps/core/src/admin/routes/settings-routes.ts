import { randomUUID } from 'node:crypto';
import { readAdminBody, sendAdminResponse } from './http.js';
import { DEFAULT_ONBOARDING, GUIDE_CHAPTERS, onboardingState, revision } from './route-state.js';
import type { AdminRouteHandler } from './types.js';

const HOOK_EVENTS = new Set([
  'session_start',
  'session_connect',
  'session_reconnect',
  'request_received',
  'prompt_received',
  'before_tool_call',
  'after_tool_call',
  'before_response',
  'after_response',
  'response_finished',
  'response_failed',
]);

const HOOK_PERMISSIONS = new Set([
  'observe',
  'block',
  'modifyPrompt',
  'modifyToolInput',
  'modifyToolOutput',
  'modifyResponse',
]);

function normalizeHook(input: any, id = input?.id ?? `hook_${randomUUID()}`) {
  const event = String(input?.event ?? 'before_tool_call');
  if (!HOOK_EVENTS.has(event)) throw new Error(`Unsupported hook event: ${event}`);
  const executable = String(input?.executable ?? '').trim();
  if (!executable) throw new Error('Hook executable is required');
  const env =
    input?.env && typeof input.env === 'object' && !Array.isArray(input.env)
      ? Object.fromEntries(Object.entries(input.env).map(([key, value]) => [key, String(value)]))
      : {};
  const permissions: string[] = [
    ...new Set<string>(
      (Array.isArray(input?.permissions) ? input.permissions : ['observe']).map((value: unknown) =>
        String(value),
      ),
    ),
  ];
  for (const permission of permissions) {
    if (!HOOK_PERMISSIONS.has(permission)) throw new Error(`Unsupported hook permission: ${permission}`);
  }
  if (!permissions.includes('observe')) permissions.unshift('observe');
  const failurePolicy = input?.failurePolicy === 'block' ? 'block' : 'continue';
  if (failurePolicy === 'block' && !permissions.includes('block')) {
    throw new Error('Blocking failure policy requires the block permission');
  }
  return {
    id: String(id),
    name: String(input?.name || input?.kind || 'Hook'),
    event,
    enabled: input?.enabled !== false,
    kind: String(input?.kind || 'command'),
    execution: input?.execution === 'launch' ? 'launch' : 'run',
    executable,
    args: Array.isArray(input?.args) ? input.args.map(String) : [],
    env,
    permissions,
    timeoutMs: Math.max(100, Math.min(60_000, Number(input?.timeoutMs) || 5_000)),
    failurePolicy,
  };
}

function hooks(context: any) {
  return context.settings?.get?.('hooks.config', []) ?? [];
}

export const handleSettingsRoutes: AdminRouteHandler = async (req, res, url, context) => {
  const path = url.pathname;
  const method = req.method ?? 'GET';

  if (path === '/api/policy/command-families' && method === 'GET') {
    sendAdminResponse(res, 200, context.settings?.get?.('command.family.overrides', {}) ?? {});
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
    sendAdminResponse(res, 200, context.settings?.get?.('network.rules', []) ?? []);
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
      (rule: any) => rule.id !== match![1],
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
        searchMaxQueries: 8,
      }) ?? {},
    );
    return true;
  }

  if (path === '/api/execution-settings' && method === 'PATCH') {
    const input = await readAdminBody(req);
    const current = context.settings?.get?.('execution.settings', {}) ?? {};
    const searchMaxQueries = Math.max(1, Math.min(32, Number(input.searchMaxQueries) || 8));
    const value = { ...current, ...input, searchMaxQueries };
    context.settings?.set?.('execution.settings', value);
    if (input.workspaceDrainMs) {
      context.settings?.set?.('workspace.drain.defaultMs', Number(input.workspaceDrainMs));
    }
    sendAdminResponse(res, 200, {
      ok: true,
      revision: context.settings?.revision?.('execution.settings') ?? 1,
      value,
    });
    return true;
  }

  if (path === '/api/hooks' && method === 'GET') {
    sendAdminResponse(res, 200, hooks(context));
    return true;
  }

  if (path === '/api/hooks' && method === 'POST') {
    try {
      const hook = normalizeHook(await readAdminBody(req));
      const next = [...hooks(context), hook];
      context.settings?.set?.('hooks.config', next);
      sendAdminResponse(res, 201, { ok: true, hook });
    } catch (error) {
      sendAdminResponse(res, 400, {
        error: { code: 'INVALID_HOOK', message: error instanceof Error ? error.message : String(error) },
      });
    }
    return true;
  }

  match = path.match(/^\/api\/hooks\/([^/]+)$/);
  if (match && method === 'PATCH') {
    const id = decodeURIComponent(match[1]!);
    const current = hooks(context);
    const existing = current.find((hook: any) => hook.id === id);
    if (!existing) {
      sendAdminResponse(res, 404, { error: { code: 'HOOK_NOT_FOUND', message: 'Hook not found' } });
      return true;
    }
    try {
      const input = await readAdminBody(req);
      const hook = normalizeHook({ ...existing, ...input }, id);
      context.settings?.set?.(
        'hooks.config',
        current.map((entry: any) => (entry.id === id ? hook : entry)),
      );
      sendAdminResponse(res, 200, { ok: true, hook });
    } catch (error) {
      sendAdminResponse(res, 400, {
        error: { code: 'INVALID_HOOK', message: error instanceof Error ? error.message : String(error) },
      });
    }
    return true;
  }

  if (match && method === 'DELETE') {
    const id = decodeURIComponent(match[1]!);
    context.settings?.set?.(
      'hooks.config',
      hooks(context).filter((hook: any) => hook.id !== id),
    );
    sendAdminResponse(res, 200, { ok: true });
    return true;
  }

  if (path === '/api/settings' && method === 'GET') {
    sendAdminResponse(res, 200, context.settings?.get?.('admin.settings', {}) ?? {});
    return true;
  }

  if (path === '/api/settings' && method === 'PATCH') {
    const input = await readAdminBody(req);
    const expected = Number(req.headers['if-match'] ?? input.revision ?? -1);
    const current = revision(context, 'admin.settings');
    if (expected >= 0 && expected !== current) {
      sendAdminResponse(res, 409, { error: { code: 'STALE_REVISION', current } });
      return true;
    }
    context.settings?.set?.('admin.settings', input.value ?? input);
    sendAdminResponse(res, 200, { ok: true, revision: revision(context, 'admin.settings') });
    return true;
  }

  if (path === '/api/onboarding' && method === 'GET') {
    sendAdminResponse(
      res,
      200,
      onboardingState(
        context.settings?.get?.('onboarding.state', DEFAULT_ONBOARDING) ?? DEFAULT_ONBOARDING,
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
