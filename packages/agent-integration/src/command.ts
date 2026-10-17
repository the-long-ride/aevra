import { AGENT_TARGETS, type AgentTarget, type AgentTransport } from './types.js';

export interface AgentCommand {
  operation: 'install' | 'uninstall' | 'status';
  target: AgentTarget | 'all';
  transport: AgentTransport;
  dryRun: boolean;
}

export function parseAgentCommand(args: string[]): AgentCommand {
  const [operation, ...tail] = args;
  if (!['install', 'uninstall', 'status'].includes(operation ?? ''))
    throw new Error('agent requires install, uninstall or status');
  let target: AgentTarget | 'all' = 'all',
    transport: AgentTransport = 'stdio',
    dryRun = false,
    named = false;
  for (let i = 0; i < tail.length; i++) {
    const arg = tail[i];
    if (arg === '--json' && operation === 'status') continue;
    if (arg === '--dry-run' && operation !== 'status') {
      dryRun = true;
      continue;
    }
    if (arg === '--transport' && operation === 'install') {
      const next = tail[++i];
      if (next !== 'stdio' && next !== 'http')
        throw new Error('--transport requires stdio or http');
      transport = next;
      continue;
    }
    if (!named && (arg === 'all' || AGENT_TARGETS.includes(arg as AgentTarget))) {
      target = arg as AgentTarget | 'all';
      named = true;
      continue;
    }
    throw new Error(`Invalid agent argument: ${arg}`);
  }
  if (operation !== 'status' && !named)
    throw new Error('agent install/uninstall requires a target or all');
  return { operation: operation as AgentCommand['operation'], target, transport, dryRun };
}
