import type { AevraCommand } from '../args.js';

type StatusCommand = Extract<AevraCommand, { command: 'status' }>;

interface ResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export interface StatusCommandDependencies<Config> {
  fetch(config: Config, path: string): Promise<ResponseLike>;
  log(message: string): void;
  error(message: string): void;
  formatError(error: unknown): string;
}

export async function runStatusCommand<Config>(
  config: Config,
  command: StatusCommand,
  dependencies: StatusCommandDependencies<Config>,
): Promise<number> {
  try {
    const response = await dependencies.fetch(config, '/api/exposure/status');
    if (!response.ok) throw new Error(`Core returned ${response.status}`);

    const status = (await response.json()) as Record<string, unknown>;
    if (command.json) {
      dependencies.log(JSON.stringify(status, null, 2));
    } else {
      const rows: Array<[string, unknown]> = [
        ['Exposure', status.provider],
        ['State', status.state],
        ['Public', status.publicUrl],
        ['Gateway', status.localGatewayUrl],
      ];
      for (const [label, value] of rows) {
        if (value !== undefined && value !== null && value !== '') {
          dependencies.log(`${label}: ${String(value)}`);
        }
      }
    }
    return 0;
  } catch (error) {
    const message = dependencies.formatError(error);
    if (command.json) {
      dependencies.log(
        JSON.stringify({
          core: 'unreachable',
          error: message,
        }),
      );
    } else {
      dependencies.error(`[aevra] status failed: ${message}. Is aevra start/service running?`);
    }
    return 1;
  }
}
