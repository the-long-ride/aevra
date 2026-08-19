import type { AevraCommand } from './args.js';

type CommandOf<Name extends AevraCommand['command']> = Extract<AevraCommand, { command: Name }>;

type Handler<Name extends AevraCommand['command']> = (
  command: CommandOf<Name>,
) => number | Promise<number>;

export interface CliDispatchHandlers {
  help: Handler<'help'>;
  start: Handler<'start'>;
  ui: Handler<'ui'>;
  setup: Handler<'setup'>;
  service: Handler<'service'>;
  connectors: Handler<'connectors'>;
  status: Handler<'status'>;
  backup: Handler<'backup'>;
  audit: Handler<'audit'>;
  sessions: Handler<'sessions'>;
  completion: Handler<'completion'>;
}

export async function dispatchCommand(
  command: AevraCommand,
  handlers: CliDispatchHandlers,
): Promise<number> {
  switch (command.command) {
    case 'help':
      return handlers.help(command);
    case 'start':
      return handlers.start(command);
    case 'ui':
      return handlers.ui(command);
    case 'setup':
      return handlers.setup(command);
    case 'service':
      return handlers.service(command);
    case 'connectors':
      return handlers.connectors(command);
    case 'status':
      return handlers.status(command);
    case 'backup':
      return handlers.backup(command);
    case 'audit':
      return handlers.audit(command);
    case 'sessions':
      return handlers.sessions(command);
    case 'completion':
      return handlers.completion(command);
  }
}
