import type { AevraCommand } from '../args.js';
import type { AdminRequestInit } from '../admin-session.js';

type ConnectionsCommand = Extract<AevraCommand, { command: 'connections' }>;

interface ResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export interface ConnectionsCommandDependencies<Config> {
  api(config: Config, path: string, init?: AdminRequestInit): Promise<ResponseLike>;
  log(message: string): void;
  error(message: string): void;
  formatError(error: unknown): string;
}

export async function runConnectionsCommand<Config>(
  config: Config,
  command: ConnectionsCommand,
  dependencies: ConnectionsCommandDependencies<Config>,
): Promise<number> {
  try {
    if (command.action === 'list') {
      const response = await dependencies.api(config, '/api/connections');
      if (!response.ok) throw new Error(`Core returned ${response.status}`);
      const items = (await response.json()) as Array<{
        id: string;
        client?: string;
        actor?: string;
        status?: string;
        lastActivityAt?: string;
      }>;
      const active = items.filter((item) => item.status !== 'REVOKED');
      if (active.length === 0) {
        dependencies.log('No active connections.');
        return 0;
      }
      for (const conn of active) {
        const client = conn.client ?? conn.actor ?? 'connection';
        const last = conn.lastActivityAt ? `  last active ${conn.lastActivityAt}` : '';
        dependencies.log(`${conn.id}  ${client}  status ${conn.status ?? 'ACTIVE'}${last}`);
      }
      return 0;
    }

    const response = await dependencies.api(
      config,
      `/api/connections/${encodeURIComponent(command.id!)}/revoke`,
      { method: 'POST', body: '{}' },
    );
    if (!response.ok) throw new Error(`Core returned ${response.status}`);
    dependencies.log(`[aevra] Revoked connection ${command.id}`);
    return 0;
  } catch (error) {
    dependencies.error(
      `[aevra] connections failed: ${dependencies.formatError(error)}. Is aevra start/service running?`,
    );
    return 1;
  }
}
