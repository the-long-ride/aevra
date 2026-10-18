import { runLocalAgentCommand } from './local-agent-command.js';

// Pre-dispatch fast path: `agent serve` must start without loading admin configuration.
export function runRootAgentEntry(argv: string[]): Promise<number | null> {
  return runLocalAgentCommand(argv);
}
