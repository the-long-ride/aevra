import type { AdminRequestInit } from '../admin-session.js';
import type { AevraCommand } from '../args.js';
import { isPendingReview, reviewHint, type McpReviewRow } from './mcp-review-format.js';
import { runMcpAccept, runMcpReview } from './mcp-review-command.js';

type McpCommand = Extract<AevraCommand, { command: 'mcp' }>;
interface ResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}
export interface McpCommandDependencies<Config> {
  api(config: Config, path: string, init?: AdminRequestInit): Promise<ResponseLike>;
  log(message: string): void;
  error(message: string): void;
  formatError(error: unknown): string;
}
async function failureMessage(response: ResponseLike): Promise<string> {
  try {
    const value = (await response.json()) as { error?: { message?: string } };
    return String(value.error?.message ?? response.status);
  } catch {
    return String(response.status);
  }
}
function registrationBody(command: McpCommand): Record<string, unknown> {
  const auth =
    command.transport === 'stdio'
      ? Object.keys(command.env ?? {}).length
        ? { env: command.env }
        : undefined
      : command.secretRef
        ? { header: command.header ?? 'Authorization', secretRefId: command.secretRef }
        : undefined;
  return {
    name: command.name,
    transport: command.transport,
    config:
      command.transport === 'stdio'
        ? { command: command.executable, args: command.args ?? [] }
        : { url: command.url },
    ...(auth ? { auth } : {}),
    risk: command.risk ?? 'MEDIUM',
  };
}
interface McpUpstreamRow extends McpReviewRow {
  transport: string;
  toolCount: number;
  risk: string;
}
function formatMcpTable(upstreams: McpUpstreamRow[]): string[] {
  const headers = ['!', 'ID', 'Name', 'Transport', 'State', 'Enabled', 'Tools', 'Risk'];
  const data = upstreams.map((u) => [
    isPendingReview(u) ? '!' : '',
    u.id,
    u.name,
    u.transport,
    u.state,
    u.enabled === false ? 'no' : 'yes',
    `${u.toolCount} tools`,
    u.risk,
  ]);
  const rows = [headers, ...data];
  const widths = headers.map((_, col) => Math.max(...rows.map((r) => (r[col] ?? '').length)));
  const border = (left: string, mid: string, right: string) =>
    `${left}${widths.map((w) => '─'.repeat(w + 2)).join(mid)}${right}`;
  const row = (cells: string[]) =>
    `│ ${cells.map((cell, i) => (cell ?? '').padEnd(widths[i]!)).join(' │ ')} │`;

  return [
    border('┌', '┬', '┐'),
    row(headers),
    border('├', '┼', '┤'),
    ...data.map((r) => row(r)),
    border('└', '┴', '┘'),
  ];
}

export async function runMcpCommand<Config>(
  config: Config,
  command: McpCommand,
  dependencies: McpCommandDependencies<Config>,
): Promise<number> {
  try {
    if (command.action === 'list') {
      const response = await dependencies.api(config, '/api/mcp/upstreams');
      if (!response.ok) throw new Error(await failureMessage(response));
      const value = (await response.json()) as {
        upstreams?: McpUpstreamRow[];
      };
      const upstreams = value.upstreams ?? [];
      if (!upstreams.length) {
        dependencies.log('No MCP servers registered.');
        return 0;
      }
      for (const line of formatMcpTable(upstreams)) dependencies.log(line);
      for (const upstream of upstreams) {
        if (isPendingReview(upstream)) dependencies.log(reviewHint(upstream));
      }
      return 0;
    }
    if (command.action === 'review') return await runMcpReview(config, command.id!, dependencies);
    if (command.action === 'accept') {
      return await runMcpAccept(config, command.id!, command.yes === true, dependencies);
    }
    if (command.action === 'add') {
      const response = await dependencies.api(config, '/api/mcp/upstreams', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(registrationBody(command)),
      });
      if (!response.ok) throw new Error(await failureMessage(response));
      const created = (await response.json()) as { id: string; name: string; toolCount: number };
      dependencies.log(`[aevra] Registered ${created.name} (${created.id})`);
      dependencies.log(`[aevra] ${created.toolCount} tools published as ${created.name}__<tool>`);
      return 0;
    }
    if (command.action === 'test') {
      const response = await dependencies.api(
        config,
        `/api/mcp/upstreams/${encodeURIComponent(command.id!)}/test`,
        { method: 'POST' },
      );
      if (!response.ok) throw new Error(await failureMessage(response));
      const result = (await response.json()) as {
        ok: boolean;
        serverName?: string | null;
        serverVersion?: string | null;
        toolCount?: number;
        message?: string | null;
      };
      if (!result.ok) {
        dependencies.error(`[aevra] mcp test failed: ${result.message ?? 'the connection failed'}`);
        return 1;
      }
      dependencies.log(
        `[aevra] Connected to ${result.serverName ?? 'unknown'} ${result.serverVersion ?? ''}`.trim(),
      );
      dependencies.log(`[aevra] ${result.toolCount ?? 0} tools available`);
      return 0;
    }
    if (command.action === 'enable' || command.action === 'disable') {
      const response = await dependencies.api(
        config,
        `/api/mcp/upstreams/${encodeURIComponent(command.id!)}/${command.action}`,
        { method: 'POST' },
      );
      if (!response.ok) throw new Error(await failureMessage(response));
      dependencies.log(
        `[aevra] ${command.action === 'enable' ? 'Enabled' : 'Disabled'} ${command.id}`,
      );
      const body = (await response.json().catch(() => ({}))) as { warning?: string };
      if (body.warning) dependencies.log(`[aevra] Warning: ${body.warning}`);
      return 0;
    }
    const response = await dependencies.api(
      config,
      `/api/mcp/upstreams/${encodeURIComponent(command.id!)}`,
      { method: 'DELETE' },
    );
    if (!response.ok) throw new Error(await failureMessage(response));
    dependencies.log(`[aevra] Removed ${command.id}`);
    return 0;
  } catch (error) {
    const code = (error as { code?: string })?.code;
    const connectivityFailure = new Set([
      'ECONNREFUSED',
      'ECONNRESET',
      'ENOTFOUND',
      'ETIMEDOUT',
      'EPIPE',
    ]).has(String(code ?? ''));
    dependencies.error(
      `[aevra] mcp failed: ${dependencies.formatError(error)}${connectivityFailure ? '. Is aevra start/service running?' : ''}`,
    );
    return 1;
  }
}
