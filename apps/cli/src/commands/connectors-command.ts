import type { AevraCommand } from '../args.js';
import type { AdminRequestInit } from '../admin-session.js';

type ConnectorsCommand = Extract<AevraCommand, { command: 'connectors' }>;

interface ResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export interface ConnectorsCommandDependencies<Config> {
  api(config: Config, path: string, init?: AdminRequestInit): Promise<ResponseLike>;
  log(message: string): void;
  error(message: string): void;
  formatError(error: unknown): string;
}

/**
 * The endpoint a connector token is actually used against, read from the
 * provider-neutral exposure status rather than from Cloudflare's.
 *
 * This used to read `/api/cloudflare/status`, which meant a deployment on
 * ngrok, a direct bind, or an external fronting proxy printed no host at all
 * and told the operator to "configure a Cloudflare hostname" they did not
 * need. `publicUrl` is the same value `aevra status` reports and the same one
 * the Web UI shows, so all three now agree.
 */
async function mcpEndpoint<Config>(
  config: Config,
  dependencies: ConnectorsCommandDependencies<Config>,
): Promise<string> {
  try {
    const response = await dependencies.api(config, '/api/exposure/status');
    if (!response.ok) return '';
    const value = (await response.json()) as { publicUrl?: unknown };
    const publicUrl = typeof value.publicUrl === 'string' ? value.publicUrl : '';
    return publicUrl ? `${publicUrl.replace(/\/+$/, '')}/mcp` : '';
  } catch {
    return '';
  }
}

export async function runConnectorsCommand<Config>(
  config: Config,
  command: ConnectorsCommand,
  dependencies: ConnectorsCommandDependencies<Config>,
): Promise<number> {
  try {
    if (command.action === 'list') {
      const response = await dependencies.api(config, '/api/connectors');
      if (!response.ok) {
        throw new Error(`Core returned ${response.status}`);
      }
      const items = (await response.json()) as Array<{
        id: string;
        name: string;
        createdAt: string;
        lastUsedAt?: string | null;
      }>;
      if (items.length === 0) {
        dependencies.log('No connectors.');
      }
      for (const connector of items) {
        dependencies.log(
          `${connector.id}  ${connector.name}  created ${connector.createdAt}${connector.lastUsedAt ? `  last used ${connector.lastUsedAt}` : ''}`,
        );
      }
      return 0;
    }

    if (command.action === 'create') {
      const response = await dependencies.api(config, '/api/connectors', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: command.name }),
      });
      if (!response.ok) {
        const value = (await response.json()) as {
          error?: { message?: string };
        };
        throw new Error(String(value.error?.message ?? response.status));
      }
      const created = (await response.json()) as {
        id: string;
        name: string;
        token: string;
      };

      const endpoint = await mcpEndpoint(config, dependencies);

      dependencies.log(`[aevra] Connector created: ${created.name} (${created.id})`);
      dependencies.log(
        endpoint
          ? `[aevra] URL: ${endpoint}`
          : '[aevra] URL: configure Remote Access to get a reachable endpoint (aevra setup)',
      );
      dependencies.log(`[aevra] Header: Authorization: Bearer ${created.token}`);
      dependencies.log('[aevra] Copy it now — the token is shown only once.');
      return 0;
    }

    const response = await dependencies.api(config, `/api/connectors/${command.id}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      throw new Error(`Core returned ${response.status}`);
    }
    dependencies.log(`[aevra] Revoked ${command.id}`);
    return 0;
  } catch (error) {
    dependencies.error(
      `[aevra] connectors failed: ${dependencies.formatError(error)}. Is aevra start/service running?`,
    );
    return 1;
  }
}
