import { estimateTokens } from '../../protocol/src/token-estimate.js';
import { toolDefinitions } from './registry.js';
import { isGroupEnabled, TOOL_GROUPS, toolGroupOf, type ToolGroup } from './tool-groups.js';

type AdvertisedTool = ReturnType<typeof toolDefinitions>[number];

const SHORT_DESCRIPTIONS: Record<string, string> = {
  'Workspace name for this operation.': 'Workspace name.',
  'Workspace ID for this operation.': 'Workspace ID.',
  'Workspace name for this batch.': 'Workspace name.',
  'Workspace ID for this batch.': 'Workspace ID.',
};
const DEPRECATED = /^Deprecated compatibility field/;

/** Deep-copies a JSON schema, dropping deprecated fields and shortening repeated workspace text. */
function compactSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(compactSchema);
  if (typeof node !== 'object' || node === null) return node;
  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === 'properties' && typeof value === 'object' && value !== null) {
      const kept: Record<string, unknown> = {};
      for (const [name, prop] of Object.entries(value as Record<string, any>)) {
        if (typeof prop?.description === 'string' && DEPRECATED.test(prop.description)) continue;
        kept[name] = compactSchema(prop);
      }
      out.properties = kept;
    } else if (key === 'description' && typeof value === 'string') {
      out.description = SHORT_DESCRIPTIONS[value] ?? value;
    } else {
      out[key] = compactSchema(value);
    }
  }
  if (Array.isArray(out.required) && out.properties) {
    out.required = out.required.filter((name: string) => name in out.properties);
    if (!out.required.length) delete out.required;
  }
  return out;
}

function compactTool(tool: AdvertisedTool): AdvertisedTool {
  const compact: Record<string, any> = { ...tool, inputSchema: compactSchema(tool.inputSchema) };
  const output = compact.outputSchema as Record<string, unknown> | undefined;
  if (output && Object.keys(output).length === 1 && output.type === 'object') {
    delete compact.outputSchema;
  }
  // MCP defaults: readOnlyHint and idempotentHint are false when absent, so only
  // those two can be dropped. destructiveHint and openWorldHint default to true.
  const annotations = { ...(compact.annotations ?? {}) } as Record<string, unknown>;
  for (const hint of ['readOnlyHint', 'idempotentHint']) {
    if (annotations[hint] === false) delete annotations[hint];
  }
  if (Object.keys(annotations).length) compact.annotations = annotations;
  else delete compact.annotations;
  return compact as AdvertisedTool;
}

let cache: AdvertisedTool[] | undefined;
function compactAll(): AdvertisedTool[] {
  return (cache ??= toolDefinitions().map(compactTool));
}

/** What `tools/list` advertises: compact schemas, optionally limited to enabled groups. */
export function advertisedToolDefinitions(groups?: readonly ToolGroup[]): AdvertisedTool[] {
  const all = compactAll();
  return groups === undefined
    ? all
    : all.filter((tool) => isGroupEnabled(toolGroupOf(tool.name), groups));
}

export function advertisedGroupTokens(): Record<'core' | ToolGroup, number> {
  const tokens = {
    core: 0,
    ...Object.fromEntries(TOOL_GROUPS.map((group) => [group, 0])),
  } as Record<'core' | ToolGroup, number>;
  for (const tool of compactAll())
    tokens[toolGroupOf(tool.name)] += estimateTokens(JSON.stringify(tool));
  return tokens;
}
