import type {
  ToolSwitchEntry,
  ToolSwitchesResponse,
} from '../../../../../packages/admin-contracts/src/tool-switches.js';
import { advertisedToolDefinitions } from '../../../../../packages/mcp-tools/src/registry-advertised.js';
import { toolGroupOf } from '../../../../../packages/mcp-tools/src/tool-groups.js';
import {
  TOOL_SWITCH_SETTING,
  disabledToolNames,
  isToolLocked,
} from '../../../../../packages/mcp-tools/src/tool-switches.js';
import { proxyName } from '../../../../../packages/mcp-tools/src/upstream-names.js';
import { readAdminBody, sendAdminResponse } from './http.js';
import type { AdminApiContext, AdminRouteHandler } from './types.js';

const PATH = '/api/tool-switches';

function fail(
  res: Parameters<AdminRouteHandler>[1],
  status: number,
  code: string,
  message: string,
) {
  sendAdminResponse(res, status, { error: { code, message } });
  return true as const;
}

function listing(context: AdminApiContext): ToolSwitchesResponse {
  const disabled = disabledToolNames(context.settings);
  const row = (
    name: string,
    source: string,
    available: boolean,
    description: unknown,
  ): ToolSwitchEntry => ({
    name,
    source,
    group: toolGroupOf(name),
    locked: isToolLocked(name),
    enabled: !disabled.has(name),
    available,
    description: typeof description === 'string' ? description : '',
  });
  const tools = advertisedToolDefinitions().map((tool) =>
    row(tool.name, 'aevra', true, (tool as { description?: unknown }).description),
  );
  for (const record of context.mcpUpstreams?.list() ?? []) {
    const available = record.enabled && record.state === 'active';
    for (const tool of record.catalog?.tools ?? []) {
      tools.push(row(proxyName(record.name, tool.name), record.name, available, tool.description));
    }
  }
  return { tools };
}

export const handleToolSwitchRoutes: AdminRouteHandler = async (req, res, url, context) => {
  if (url.pathname !== PATH) return false;
  if (req.method === 'GET') {
    sendAdminResponse(res, 200, listing(context));
    return true;
  }
  if (req.method !== 'PUT') return fail(res, 405, 'METHOD_NOT_ALLOWED', 'Use GET or PUT.');
  const body = await readAdminBody(req);
  const list = body?.disabled;
  if (!Array.isArray(list) || list.some((name: unknown) => typeof name !== 'string')) {
    return fail(res, 400, 'INVALID_TOOL_SWITCHES', 'Body must be { disabled: string[] }.');
  }
  const known = new Set(listing(context).tools.map((tool) => tool.name));
  const unknown = list.filter((name: string) => !known.has(name));
  if (unknown.length) {
    return fail(res, 400, 'UNKNOWN_TOOL', `Unknown tools: ${unknown.join(', ')}.`);
  }
  const locked = list.filter((name: string) => isToolLocked(name));
  if (locked.length) {
    return fail(res, 400, 'TOOL_LOCKED', `Core tools cannot be turned off: ${locked.join(', ')}.`);
  }
  const names = [...new Set<string>(list)].sort();
  context.settings?.set?.(TOOL_SWITCH_SETTING, { names });
  context.audit?.append?.({
    actor: 'admin',
    operation: 'tools.switches.update',
    target: `disabled=${names.length}`,
    result: 'ok',
    redactionCount: 0,
    class: 'normal',
  });
  sendAdminResponse(res, 200, listing(context));
  return true;
};
