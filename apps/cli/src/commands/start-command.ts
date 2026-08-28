import type { AdminUiDestination, AevraCommand } from '../args.js';
import { START_STOP_LINE } from '../cli-support.js';

type StartCommand = Extract<AevraCommand, { command: 'start' }>;

interface ReadyInfo {
  adminUrl: string;
  mcpUrl: string;
  gatewayUrl?: string;
}

export interface StartCommandDependencies<Config> {
  run(config: Config, hooks: { onReady(info: ReadyInfo): void | Promise<void> }): Promise<number>;
  readyLines(info: ReadyInfo): string[];
  openUi(config: Config, destination: AdminUiDestination): Promise<void>;
  error(message: string): void;
  formatError(error: unknown): string;
}

export async function runStartCommand<Config>(
  config: Config,
  command: StartCommand,
  dependencies: StartCommandDependencies<Config>,
): Promise<number> {
  try {
    return await dependencies.run(config, {
      async onReady(info) {
        for (const line of dependencies.readyLines(info)) {
          dependencies.error(line);
        }

        if (info.gatewayUrl?.startsWith('http://')) {
          dependencies.error(
            '[aevra] Warning: HTTP is enabled only for the local gateway on 127.0.0.1. Admin and MCP remain HTTPS.',
          );
          dependencies.error(
            '[aevra] Use HTTP only for localhost or behind a secure tunnel/reverse proxy. Use HTTPS for direct exposure.',
          );
        }

        if (command.uiDestination) {
          try {
            await dependencies.openUi(config, command.uiDestination);
          } catch (error) {
            dependencies.error(`[aevra] UI launch failed: ${dependencies.formatError(error)}`);
          }
        }

        dependencies.error(START_STOP_LINE);
      },
    });
  } catch (error) {
    dependencies.error(`[aevra] ${dependencies.formatError(error)}`);
    return 1;
  }
}
