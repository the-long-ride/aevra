import type { AevraCommand } from './args.js';

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

/** `mcp accept <id> [--yes]`: --yes is the only option, and may appear once. */
function parseMcpAccept(rest: string[]): AevraCommand {
  const id = rest[1];
  if (!id || id.startsWith('--')) throw new Error('mcp accept requires an id');
  let yes = false;
  for (const flag of rest.slice(2)) {
    if (flag !== '--yes' || yes) throw new Error(`Unknown mcp accept option: ${flag}`);
    yes = true;
  }
  return { command: 'mcp', action: 'accept', id, yes };
}

export function parseMcpArgs(rest: string[]): AevraCommand {
  const action = rest[0];
  if (action === 'list') {
    if (rest.length !== 1) throw new Error('mcp list takes no arguments');
    return { command: 'mcp', action: 'list' };
  }
  if (action === 'add') return parseMcpAdd(rest);
  if (action === 'accept') return parseMcpAccept(rest);
  if (
    action === 'remove' ||
    action === 'test' ||
    action === 'enable' ||
    action === 'disable' ||
    action === 'review'
  ) {
    const id = rest[1];
    if (rest.length !== 2 || !id) throw new Error(`mcp ${action} requires an id`);
    return { command: 'mcp', action, id };
  }
  throw new Error(
    'mcp requires list|add <name> …|remove <id>|test <id>|enable <id>|disable <id>|review <id>|accept <id> [--yes]',
  );
}
