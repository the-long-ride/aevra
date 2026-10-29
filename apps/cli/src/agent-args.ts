import {
  AGENT_TARGETS,
  type AgentScope,
  type AgentTarget,
  type AgentTransport,
} from '../../../packages/agent-integration/src/types.js';

export interface AgentCliCommand {
  command: 'agent';
  action: 'list' | 'install' | 'uninstall';
  targets: Array<AgentTarget | 'all'>;
  scope?: AgentScope;
  workspace?: string;
  id?: string; // uninstall only: the connection (credential) id of one registration
  transport: AgentTransport;
  dryRun: boolean;
  yes: boolean;
  json: boolean;
}

export type AgentParse = AgentCliCommand | { command: 'agent-help' };

const ALIASES: Record<string, AgentTarget> = {
  claude: 'claude-code',
  agy: 'antigravity-cli',
};
const ACTIONS = ['list', 'install', 'uninstall'];

function target(value: string): AgentTarget | 'all' {
  if (value === 'all') return 'all';
  const resolved = ALIASES[value] ?? value;
  if (AGENT_TARGETS.includes(resolved as AgentTarget)) return resolved as AgentTarget;
  throw new Error(`Unknown agent: ${value}. Use ${AGENT_TARGETS.join(', ')} or all`);
}

function valueOf(tail: string[], at: number, flag: string, hint: string): string {
  const value = tail[at];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires ${hint}`);
  return value;
}

export function parseAgentArgs(rest: string[]): AgentParse {
  if (rest.length === 0 || rest[0] === 'help' || rest.some((a) => a === '--help' || a === '-h'))
    return { command: 'agent-help' };
  const [verb, ...tail] = rest;
  const action = verb === 'status' ? 'list' : verb!;
  if (!ACTIONS.includes(action)) {
    if (verb === 'serve')
      throw new Error('agent serve is internal: aevra agent serve --credential-file <file>');
    throw new Error(`Unknown agent command: ${verb}. Use list, install, uninstall or status`);
  }
  const list = action === 'list';
  const install = action === 'install';
  let scope: AgentScope | undefined;
  let workspace: string | undefined;
  let id: string | undefined;
  let transport: AgentTransport = 'stdio';
  let dryRun = false;
  let yes = false;
  let json = false;
  const named: Array<AgentTarget | 'all'> = [];
  for (let at = 0; at < tail.length; at += 1) {
    const arg = tail[at]!;
    if (arg === '--json') json = true;
    else if (arg === '--dry-run' && !list) dryRun = true;
    else if (arg === '--yes' && install) yes = true;
    else if (arg === '--transport' && install) {
      const value = valueOf(tail, (at += 1), arg, 'stdio or http');
      if (value !== 'stdio' && value !== 'http')
        throw new Error('--transport requires stdio or http');
      transport = value;
    } else if (arg === '--scope' && !list) {
      const value = valueOf(tail, (at += 1), arg, 'user or workspace');
      if (value !== 'user' && value !== 'workspace')
        throw new Error('--scope requires user or workspace');
      if (scope !== undefined) throw new Error('--scope was given more than once');
      scope = value;
    } else if (arg === '--workspace' && !list) {
      const value = valueOf(tail, (at += 1), arg, 'a workspace name or id');
      if (workspace !== undefined) throw new Error('--workspace was given more than once');
      workspace = value;
    } else if (arg === '--id' && action === 'uninstall') {
      const value = valueOf(tail, (at += 1), arg, 'a connection id');
      if (id !== undefined) throw new Error('--id was given more than once');
      id = value;
    } else if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
    else if (list) throw new Error('agent list takes no agent names');
    else {
      const resolved = target(arg);
      if (!named.includes(resolved)) named.push(resolved);
    }
  }
  if (id !== undefined && (named.length || scope !== undefined || workspace !== undefined))
    throw new Error('--id cannot be combined with agent names, all, --scope or --workspace');
  if (named.includes('all') && named.length > 1)
    throw new Error('all cannot be combined with named agents');
  if (workspace !== undefined && scope === 'user')
    throw new Error('--workspace cannot be combined with --scope user');
  if (workspace !== undefined) scope = 'workspace';
  if (scope === 'workspace' && workspace === undefined)
    throw new Error('--scope workspace requires --workspace <name>');
  if (scope === 'workspace' && transport === 'http')
    throw new Error('--transport http cannot be used with workspace scope: use stdio');
  if (action === 'uninstall' && named.length === 0 && id === undefined)
    throw new Error('agent uninstall requires an agent name, all or --id <id>');
  return {
    command: 'agent',
    action: action as AgentCliCommand['action'],
    targets: named.includes('all') ? ['all'] : named,
    ...(scope === undefined ? {} : { scope }),
    ...(workspace === undefined ? {} : { workspace }),
    ...(id === undefined ? {} : { id }),
    transport,
    dryRun,
    yes,
    json,
  };
}
