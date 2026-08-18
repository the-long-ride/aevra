import type { Capability } from '../../../../../packages/protocol/src/index.js';
import { readAdminBody, sendAdminResponse } from './http.js';
import type { AdminRouteHandler } from './types.js';

export const handleWorkspaceRoutes: AdminRouteHandler = async (
  req,
  res,
  url,
  context,
) => {
  const path = url.pathname;
  const method = req.method ?? 'GET';

  if (path === '/api/workspaces' && method === 'GET') {
    sendAdminResponse(
      res,
      200,
      context.workspaces?.listLocal?.() ??
        context.workspaces?.listRemote?.() ??
        [],
    );
    return true;
  }

  if (path === '/api/workspaces' && method === 'POST') {
    const input = await readAdminBody(req);
    const workspace = context.workspaces.create({
      name: String(input.name),
      description: String(input.description ?? ''),
      hostRoot: String(input.hostRoot),
    });
    sendAdminResponse(res, 200, {
      ok: true,
      revision: Date.now(),
      workspace,
    });
    return true;
  }

  let match = path.match(/^\/api\/workspaces\/([^/]+)$/);
  if (match && method === 'PATCH') {
    const workspace = context.workspaces.update(
      match[1],
      await readAdminBody(req),
    );
    sendAdminResponse(res, 200, {
      ok: true,
      revision: Date.now(),
      workspace,
    });
    return true;
  }
  if (match && method === 'DELETE') {
    context.workspaces.delete(match[1]);
    sendAdminResponse(res, 200, { ok: true, revision: Date.now() });
    return true;
  }

  match = path.match(/^\/api\/workspaces\/([^/]+)\/mounts$/);
  if (match && method === 'GET') {
    sendAdminResponse(
      res,
      200,
      context.workspaces?.listMountsLocal?.(match[1]) ??
        context.workspaces?.listMountsRemote?.(match[1]) ??
        [],
    );
    return true;
  }
  if (match && method === 'POST') {
    const input = await readAdminBody(req);
    const mount = context.workspaces.addMount(match[1], {
      logicalPath: String(input.logicalPath),
      hostRoot: String(input.hostRoot),
      capabilities: (input.capabilities ?? []) as Capability[],
      sensitivityPolicyId: input.sensitivityPolicyId,
    });
    sendAdminResponse(res, 200, {
      ok: true,
      revision: Date.now(),
      mount,
    });
    return true;
  }

  match = path.match(/^\/api\/mounts\/([^/]+)$/);
  if (match && method === 'DELETE') {
    context.workspaces.deleteMount(match[1]);
    sendAdminResponse(res, 200, { ok: true, revision: Date.now() });
    return true;
  }

  match = path.match(/^\/api\/workspaces\/([^/]+)\/admission$/);
  if (match && method === 'POST') {
    const input = await readAdminBody(req);
    context.profiles?.mapActor?.(
      String(input.actor),
      match[1],
      String(input.profileId ?? 'developer'),
      input.admission === 'ask' ? 'ask' : 'auto',
    );
    sendAdminResponse(res, 200, { ok: true, revision: Date.now() });
    return true;
  }

  return false;
};
