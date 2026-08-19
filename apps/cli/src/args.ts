export type AdminUiDestination = '/' | '/react/';

export type AevraCommand =
  | { command: 'help' }
  | { command: 'start'; uiDestination: AdminUiDestination | null }
  | { command: 'ui'; logoutAll: boolean }
  | { command: 'setup' }
  | {
      command: 'service';
      action: 'install' | 'start' | 'stop' | 'restart' | 'status';
    }
  | {
      command: 'connectors';
      action: 'list' | 'create' | 'revoke';
      name?: string;
      id?: string;
    }
  | { command: 'status'; json: boolean }
  | {
      command: 'backup';
      action: 'verify' | 'restore';
      file: string;
      yes: boolean;
    }
  | { command: 'audit'; action: 'clear'; yes: boolean }
  | { command: 'sessions'; action: 'revoke-others'; yes: boolean }
  | { command: 'completion'; shell: 'bash' | 'zsh' | 'powershell' };

export function parseAevraArgs(argv: string[]): AevraCommand {
  if (
    argv.length === 0 ||
    ['help', '--help', '-h', '-help'].includes(argv[0]!)
  ) {
    return { command: 'help' };
  }

  const [command, ...rest] = argv;

  if (command === 'start') {
    let uiDestination: AdminUiDestination | null = null;
    for (const arg of rest) {
      const next =
        arg === '--ui' ? '/' : arg === '--ui-react' ? '/react/' : null;
      if (!next) throw new Error(`Unknown option: ${arg}`);
      if (uiDestination && uiDestination !== next) {
        throw new Error('--ui and --ui-react are mutually exclusive');
      }
      uiDestination = next;
    }
    return { command: 'start', uiDestination };
  }

  if (command === 'setup') {
    if (rest.length) throw new Error(`Unknown option: ${rest[0]}`);
    return { command: 'setup' };
  }

  if (command === 'ui') {
    let logoutAll = false;
    for (const arg of rest) {
      if (arg === '--logout-all') logoutAll = true;
      else throw new Error(`Unknown option: ${arg}`);
    }
    return { command: 'ui', logoutAll };
  }

  if (command === 'service') {
    const action = rest[0];
    if (
      rest.length !== 1 ||
      !['install', 'start', 'stop', 'restart', 'status'].includes(action ?? '')
    ) {
      throw new Error('service requires install|start|stop|restart|status');
    }
    return {
      command: 'service',
      action: action as 'install' | 'start' | 'stop' | 'restart' | 'status',
    };
  }

  if (command === 'status') {
    let json = false;
    for (const arg of rest) {
      if (arg === '--json') json = true;
      else throw new Error(`Unknown option: ${arg}`);
    }
    return { command: 'status', json };
  }

  if (command === 'completion') {
    const shell = rest[0];
    if (
      rest.length !== 1 ||
      !['bash', 'zsh', 'powershell'].includes(shell ?? '')
    ) {
      throw new Error('completion requires bash|zsh|powershell');
    }
    return {
      command: 'completion',
      shell: shell as 'bash' | 'zsh' | 'powershell',
    };
  }

  if (command === 'backup') {
    const action = rest[0];
    if (action !== 'verify' && action !== 'restore') {
      throw new Error('backup requires verify|restore <file>');
    }
    const file = rest[1];
    if (rest.length < 2 || !file) {
      throw new Error('backup requires a file path');
    }
    const yes = rest.includes('--yes');
    if (rest.length > 3 || (rest.length === 3 && !yes)) {
      throw new Error('Unknown backup option');
    }
    return { command: 'backup', action, file, yes };
  }

  if (command === 'audit') {
    if (rest[0] !== 'clear') {
      throw new Error('audit requires clear [--yes]');
    }
    const yes = rest.includes('--yes');
    if (rest.length > 2 || (rest.length === 2 && !yes)) {
      throw new Error('Unknown audit option');
    }
    return { command: 'audit', action: 'clear', yes };
  }

  if (command === 'sessions') {
    if (rest[0] !== 'revoke-others') {
      throw new Error('sessions requires revoke-others [--yes]');
    }
    const yes = rest.includes('--yes');
    if (rest.length > 2 || (rest.length === 2 && !yes)) {
      throw new Error('Unknown sessions option');
    }
    return { command: 'sessions', action: 'revoke-others', yes };
  }

  if (command === 'connectors') {
    const action = rest[0];
    if (action === 'list') {
      if (rest.length !== 1) {
        throw new Error('connectors list takes no arguments');
      }
      return { command: 'connectors', action: 'list' };
    }
    if (action === 'create') {
      if (rest.length !== 2 || !rest[1]) {
        throw new Error('connectors create requires a name');
      }
      return {
        command: 'connectors',
        action: 'create',
        name: rest[1],
      };
    }
    if (action === 'revoke') {
      if (rest.length !== 2 || !rest[1]) {
        throw new Error('connectors revoke requires an id');
      }
      return {
        command: 'connectors',
        action: 'revoke',
        id: rest[1],
      };
    }
    throw new Error('connectors requires list|create <name>|revoke <id>');
  }

  throw new Error(`Unknown command: ${command}`);
}
