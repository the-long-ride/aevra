import type { AevraCommand } from '../args.js';

type UiCommand = Extract<AevraCommand, { command: 'ui' }>;

export interface UiCommandDependencies<Config> {
  createUrl(config: Config): Promise<string>;
  revokeAll(config: Config): Promise<number>;
  openBrowser(url: string): void;
  error(message: string): void;
  formatError(error: unknown): string;
}

export async function runUiCommand<Config>(
  config: Config,
  command: UiCommand,
  dependencies: UiCommandDependencies<Config>,
): Promise<number> {
  try {
    if (command.logoutAll) {
      await dependencies.revokeAll(config);
      dependencies.error('[aevra] Revoked all local admin sessions.');
      return 0;
    }

    const url = await dependencies.createUrl(config);
    dependencies.openBrowser(url);
    dependencies.error(`[aevra] Opening ${url}`);
    return 0;
  } catch (error) {
    dependencies.error(
      `[aevra] ${dependencies.formatError(error)}. Is aevra start/service running?`,
    );
    return 1;
  }
}
