import type { AevraCommand } from '../args.js';

type ServiceCommand = Extract<AevraCommand, { command: 'service' }>;

export interface ServiceAdapter {
  install(): Promise<unknown>;
  start(): Promise<unknown>;
  stop(): Promise<unknown>;
  restart(): Promise<unknown>;
  status(): Promise<string>;
}

export interface ServiceCommandDependencies {
  log(message: string): void;
  error(message: string): void;
  formatError(error: unknown): string;
}

export async function runServiceCommand(
  command: ServiceCommand,
  service: ServiceAdapter,
  dependencies: ServiceCommandDependencies,
): Promise<number> {
  try {
    if (command.action === 'install') await service.install();
    else if (command.action === 'start') await service.start();
    else if (command.action === 'stop') await service.stop();
    else if (command.action === 'restart') await service.restart();
    else dependencies.log(await service.status());
    return 0;
  } catch (error) {
    dependencies.error(
      `[aevra] service ${command.action} failed: ${dependencies.formatError(error)}`,
    );
    return 1;
  }
}
