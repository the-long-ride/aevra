import type { AevraCommand } from '../args.js';
import type { AdminRequestInit } from '../admin-session.js';

type MaintenanceCommand = Extract<
  AevraCommand,
  { command: 'audit' | 'sessions' }
>;

interface ResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export interface MaintenanceCommandDependencies<Config> {
  api(
    config: Config,
    path: string,
    init?: AdminRequestInit,
  ): Promise<ResponseLike>;
  log(message: string): void;
  error(message: string): void;
  formatError(error: unknown): string;
}

export async function runMaintenanceCommand<Config>(
  config: Config,
  command: MaintenanceCommand,
  dependencies: MaintenanceCommandDependencies<Config>,
): Promise<number> {
  if (!command.yes) {
    if (command.command === 'audit') {
      dependencies.error(
        '[aevra] audit clear permanently removes audit event rows. Re-run with --yes to confirm.',
      );
    } else {
      dependencies.error(
        '[aevra] revoke-others removes non-connector MCP sessions and other admin sessions. Re-run with --yes to confirm.',
      );
    }
    return 1;
  }

  try {
    if (command.command === 'audit') {
      const response = await dependencies.api(config, '/api/audit', {
        method: 'DELETE',
      });
      if (!response.ok) {
        throw new Error(`Core returned ${response.status}`);
      }
      const value = (await response.json()) as { removed?: number };
      dependencies.log(`[aevra] Cleared ${value.removed ?? 0} audit event(s).`);
      return 0;
    }

    const response = await dependencies.api(config, '/api/sessions/revoke-others', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    if (!response.ok) {
      throw new Error(`Core returned ${response.status}`);
    }
    const value = (await response.json()) as {
      revokedRemote?: number;
      revokedAdmin?: number;
      preservedConnectors?: number;
      preservedAdmin?: number;
    };
    dependencies.log(
      `[aevra] Revoked ${value.revokedRemote ?? 0} remote and ${value.revokedAdmin ?? 0} admin session(s); preserved ${value.preservedConnectors ?? 0} connector and ${value.preservedAdmin ?? 0} current admin session(s).`,
    );
    return 0;
  } catch (error) {
    const action = command.command === 'audit' ? 'audit clear' : 'sessions revoke-others';
    dependencies.error(
      `[aevra] ${action} failed: ${dependencies.formatError(error)}. Is aevra start/service running?`,
    );
    return 1;
  }
}
