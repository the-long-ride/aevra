import type { AdminUiDestination, AevraCommand } from '../args.js';

type StartCommand = Extract<AevraCommand, { command: 'start' }>;

interface ReadyInfo {
  adminUrl: string;
  mcpUrl: string;
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

        if (!command.uiDestination) {
          return;
        }

        try {
          await dependencies.openUi(config, command.uiDestination);
        } catch (error) {
          dependencies.error(`[aevra] UI launch failed: ${dependencies.formatError(error)}`);
        }
      },
    });
  } catch (error) {
    dependencies.error(`[aevra] ${dependencies.formatError(error)}`);
    return 1;
  }
}
