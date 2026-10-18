import path from 'node:path';
import { AGENT_TARGETS, type AgentOptions, type Registration } from './types.js';
import { agentLocation } from './adapters.js';
import { projectKeyMatch, rootKey } from './claude-project-key.js';

const same = (left: string[], right: string[]) =>
  left.length === right.length && left.every((segment, index) => segment === right[index]);

function invalid(): never {
  throw new Error('AGENT_MANIFEST_INVALID: registration paths do not match this installation');
}

// Pins every manifest-controlled path to what this installation would compute. Never reads a
// config file: the Claude project key is validated against the root, not against ~/.claude.json.
export function checkRegistration(
  options: AgentOptions,
  reg: Registration,
  seen: Set<string>,
  platform: NodeJS.Platform = process.platform,
): void {
  const root = reg.workspaceRoot;
  if (
    !AGENT_TARGETS.includes(reg.target) ||
    (reg.scope !== 'user' && reg.scope !== 'workspace') ||
    !Array.isArray(reg.entryPath) ||
    reg.entryPath.some((segment) => typeof segment !== 'string')
  )
    invalid();
  if (reg.scope === 'user' ? root !== undefined : !isNormalisedRoot(root)) invalid();
  const claude = reg.scope === 'workspace' && reg.target === 'claude-code';
  if (
    claude &&
    (reg.entryPath.length !== 3 ||
      reg.entryPath[0] !== 'projects' ||
      reg.entryPath[2] !== 'mcpServers' ||
      projectKeyMatch(reg.entryPath[1], platform) !== projectKeyMatch(root!, platform))
  )
    invalid();
  const expected = agentLocation(
    reg.target,
    options.home,
    options.env,
    reg.scope,
    root,
    claude ? reg.entryPath[1] : undefined,
  );
  const key = [reg.target, reg.scope, rootKey(root ?? '', platform)].join('\0');
  if (
    reg.config !== expected.config ||
    !same(reg.entryPath, expected.entryPath) ||
    path.dirname(reg.credentialFile) !== path.join(options.stateDir, 'agent-credentials') ||
    seen.has(key)
  )
    invalid();
  seen.add(key);
}

function isNormalisedRoot(root: unknown): root is string {
  return typeof root === 'string' && path.isAbsolute(root) && path.resolve(root) === root;
}
