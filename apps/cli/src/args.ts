export type AdminUiDestination = '/';

export type AevraCommand =
  | { command: 'help' }
  | { command: 'version' }
  | { command: 'about' }
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
  | { command: 'extension'; action: 'install'; dir?: string; yes: boolean }
  | {
      command: 'connections';
      action: 'list' | 'revoke';
      id?: string;
    }
  | {
      command: 'sessions';
      action: 'list' | 'revoke' | 'revoke-others';
      id?: string;
      yes?: boolean;
    }
  | {
      command: 'mcp';
      action: 'list' | 'add' | 'remove' | 'test';
      name?: string;
      id?: string;
      transport?: 'stdio' | 'http' | 'sse';
      executable?: string;
      args?: string[];
      url?: string;
      risk?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
      header?: string;
      secretRef?: string;
      env?: Record<string, string>;
    }
  | { command: 'completion'; shell: 'bash' | 'zsh' | 'powershell' };

const MCP_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;
const MCP_SECRET_REF_PATTERN = /^sr_[A-Za-z0-9._-]{1,64}$/;
const MCP_RISKS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
function mcpSecretRef(value: string): string {
  if (!MCP_SECRET_REF_PATTERN.test(value))
    throw new Error('Credentials must be given as a secret reference id (sr_...), not a value');
  return value;
}
function parseMcpAdd(rest: string[]): AevraCommand {
  const name = rest[1];
  if (!name || name.startsWith('--')) throw new Error('mcp add requires a name');
  if (!MCP_NAME_PATTERN.test(name))
    throw new Error('mcp add requires a lowercase name of letters, digits and dashes');
  let transport: 'stdio' | 'http' | 'sse' | undefined,
    url: string | undefined,
    executable: string | undefined,
    risk: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'MEDIUM',
    header: string | undefined,
    secretRef: string | undefined;
  const args: string[] = [],
    env: Record<string, string> = {};
  for (let at = 2; at < rest.length; at += 1) {
    const flag = rest[at],
      value = rest[at + 1];
    if (!value || (value.startsWith('--') && flag !== '--arg'))
      throw new Error(`${flag} requires a value`);
    at += 1;
    if (flag === '--transport') {
      if (!['stdio', 'http', 'sse'].includes(value))
        throw new Error('--transport requires stdio|http|sse');
      transport = value as typeof transport;
    } else if (flag === '--url') url = value;
    else if (flag === '--command') executable = value;
    else if (flag === '--arg') args.push(value);
    else if (flag === '--header') header = value;
    else if (flag === '--secret-ref') secretRef = mcpSecretRef(value);
    else if (flag === '--env') {
      const split = value.indexOf('=');
      if (split <= 0) throw new Error('--env requires NAME=sr_reference');
      env[value.slice(0, split)] = mcpSecretRef(value.slice(split + 1));
    } else if (flag === '--risk') {
      if (!MCP_RISKS.includes(value)) throw new Error('--risk requires LOW|MEDIUM|HIGH|CRITICAL');
      risk = value as typeof risk;
    } else throw new Error(`Unknown mcp add option: ${flag}`);
  }
  if (!transport) throw new Error('mcp add requires --transport stdio|http|sse');
  if (transport === 'stdio') {
    if (!executable) throw new Error('a stdio server requires --command');
    return { command: 'mcp', action: 'add', name, transport, executable, args, env, risk };
  }
  if (!url) throw new Error('an http or sse server requires --url');
  return {
    command: 'mcp',
    action: 'add',
    name,
    transport,
    url,
    ...(header ? { header } : {}),
    ...(secretRef ? { secretRef } : {}),
    args,
    env,
    risk,
  };
}

export function parseAevraArgs(argv: string[]): AevraCommand {
  if (argv.length === 0 || ['help', '--help', '-h', '-help'].includes(argv[0]!)) {
    return { command: 'help' };
  }

  if (['version', '--version', '-v', '-version'].includes(argv[0]!)) {
    return { command: 'version' };
  }

  if (argv[0] === 'about') {
    if (argv.length > 1) throw new Error(`Unknown option: ${argv[1]}`);
    return { command: 'about' };
  }

  const [command, ...rest] = argv;

  if (command === 'start') {
    let uiDestination: AdminUiDestination | null = null;
    for (const arg of rest) {
      if (arg !== '--ui') throw new Error(`Unknown option: ${arg}`);
      uiDestination = '/';
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
    if (rest.length !== 1 || !['bash', 'zsh', 'powershell'].includes(shell ?? '')) {
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

  if (command === 'extension') {
    if (rest[0] !== 'install') {
      throw new Error('extension requires install [--dir <path>] [--yes]');
    }
    let dir: string | undefined;
    let yes = false;
    for (let at = 1; at < rest.length; at += 1) {
      const arg = rest[at];
      if (arg === '--yes') {
        yes = true;
        continue;
      }
      if (arg === '--dir') {
        const value = rest[at + 1];
        if (!value || value.startsWith('--')) throw new Error('--dir requires a path');
        dir = value;
        at += 1;
        continue;
      }
      throw new Error(`Unknown extension option: ${arg}`);
    }
    return dir === undefined
      ? { command: 'extension', action: 'install', yes }
      : { command: 'extension', action: 'install', dir, yes };
  }

  if (command === 'sessions') {
    const action = rest[0];
    if (action === 'list') {
      if (rest.length !== 1) throw new Error('sessions list takes no arguments');
      return { command: 'sessions', action: 'list' };
    }
    if (action === 'revoke') {
      if (rest.length !== 2 || !rest[1]) throw new Error('sessions revoke requires an id');
      return { command: 'sessions', action: 'revoke', id: rest[1] };
    }
    if (action === 'revoke-others') {
      const yes = rest.includes('--yes');
      if (rest.length > 2 || (rest.length === 2 && !yes))
        throw new Error('Unknown sessions option');
      return { command: 'sessions', action: 'revoke-others', yes };
    }
    throw new Error('sessions requires list|revoke <id>|revoke-others [--yes]');
  }

  if (command === 'connections') {
    const action = rest[0];
    if (action === 'list') {
      if (rest.length !== 1) throw new Error('connections list takes no arguments');
      return { command: 'connections', action: 'list' };
    }
    if (action === 'revoke') {
      if (rest.length !== 2 || !rest[1]) throw new Error('connections revoke requires an id');
      return { command: 'connections', action: 'revoke', id: rest[1] };
    }
    throw new Error('connections requires list|revoke <id>');
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

  if (command === 'mcp') {
    const action = rest[0];
    if (action === 'list') {
      if (rest.length !== 1) throw new Error('mcp list takes no arguments');
      return { command: 'mcp', action: 'list' };
    }
    if (action === 'add') return parseMcpAdd(rest);
    if (action === 'remove' || action === 'test') {
      const id = rest[1];
      if (rest.length !== 2 || !id) throw new Error(`mcp ${action} requires an id`);
      return { command: 'mcp', action, id };
    }
    throw new Error('mcp requires list|add <name> …|remove <id>|test <id>');
  }

  throw new Error(`Unknown command: ${command}`);
}
