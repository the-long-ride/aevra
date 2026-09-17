import type { RiskTier } from '../../../../packages/protocol/src/index.js';
import type { UpstreamCatalog } from '../../../../packages/mcp-upstream/src/protocol.js';
import type { CatalogDiff } from '../../../../packages/mcp-upstream/src/fingerprint.js';

export const UPSTREAM_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;
export type UpstreamState = 'active' | 'degraded' | 'needs-review';
export type UpstreamTransportKind = 'stdio' | 'http' | 'sse';

export interface UpstreamAuth {
  header?: string;
  secretRefId?: string;
  env?: Record<string, string>;
}

export type UpstreamStoredConfig =
  { command: string; args: string[]; cwd?: string } | { url: string };

export type UpstreamCatalogDiff = CatalogDiff;

export interface UpstreamRecord {
  id: string;
  name: string;
  transport: UpstreamTransportKind;
  config: UpstreamStoredConfig;
  auth: UpstreamAuth;
  risk: RiskTier;
  enabled: boolean;
  catalogFingerprint: string | null;
  catalog: UpstreamCatalog | null;
  pendingCatalog: UpstreamCatalog | null;
  pendingCatalogDiff: UpstreamCatalogDiff | null;
  state: UpstreamState;
  createdAt: string;
  updatedAt: string;
}

export function invalidUpstream(message: string, code: string): Error {
  return Object.assign(new Error(`${code}: ${message}`), { code, status: 400 });
}

export function assertValidUpstreamName(name: unknown): asserts name is string {
  if (typeof name !== 'string' || !UPSTREAM_NAME_PATTERN.test(name)) {
    throw invalidUpstream(
      `An upstream name must match ${UPSTREAM_NAME_PATTERN.source}; got ${JSON.stringify(name)}`,
      'MCP_UPSTREAM_NAME_INVALID',
    );
  }
}

function parseStdioConfig(record: Record<string, unknown>): UpstreamStoredConfig {
  const command = record.command;
  if (typeof command !== 'string' || !command.trim())
    throw invalidUpstream('A stdio upstream needs a command', 'MCP_UPSTREAM_CONFIG_INVALID');
  const args = record.args === undefined ? [] : record.args;
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string'))
    throw invalidUpstream(
      'A stdio upstream takes an array of string args',
      'MCP_UPSTREAM_CONFIG_INVALID',
    );
  const cwd = record.cwd;
  if (cwd !== undefined && typeof cwd !== 'string')
    throw invalidUpstream('A stdio upstream cwd must be a string', 'MCP_UPSTREAM_CONFIG_INVALID');
  return { command, args: args as string[], ...(cwd === undefined ? {} : { cwd }) };
}

function parseUrlConfig(record: Record<string, unknown>): UpstreamStoredConfig {
  const url = record.url;
  if (typeof url !== 'string' || !url)
    throw invalidUpstream('An http or sse upstream needs a url', 'MCP_UPSTREAM_CONFIG_INVALID');
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw invalidUpstream(
      'An http or sse upstream needs an absolute url',
      'MCP_UPSTREAM_CONFIG_INVALID',
    );
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
    throw invalidUpstream(
      'An http or sse upstream url must use http: or https:',
      'MCP_UPSTREAM_CONFIG_INVALID',
    );
  if (parsed.username || parsed.password)
    throw invalidUpstream(
      'Credentials in upstream URLs are not allowed; use a secret reference instead',
      'MCP_UPSTREAM_CONFIG_INVALID',
    );
  return { url: parsed.toString() };
}

export function parseStoredConfig(
  transport: UpstreamTransportKind,
  value: unknown,
): UpstreamStoredConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw invalidUpstream('An upstream config must be an object', 'MCP_UPSTREAM_CONFIG_INVALID');
  const record = value as Record<string, unknown>;
  return transport === 'stdio' ? parseStdioConfig(record) : parseUrlConfig(record);
}

export function rowToRecord(row: unknown): UpstreamRecord {
  const r = row as Record<string, unknown>;
  const transport = String(r.transport) as UpstreamTransportKind;
  return {
    id: String(r.id),
    name: String(r.name),
    transport,
    config: parseStoredConfig(transport, JSON.parse(String(r.configJson))),
    auth: JSON.parse(String(r.authJson ?? '{}')) as UpstreamAuth,
    risk: String(r.risk) as RiskTier,
    enabled: Number(r.enabled) === 1,
    catalogFingerprint:
      r.catalogFingerprint === null || r.catalogFingerprint === undefined
        ? null
        : String(r.catalogFingerprint),
    catalog: r.catalogJson ? (JSON.parse(String(r.catalogJson)) as UpstreamCatalog) : null,
    pendingCatalog: r.pendingCatalogJson
      ? (JSON.parse(String(r.pendingCatalogJson)) as UpstreamCatalog)
      : null,
    pendingCatalogDiff: r.pendingCatalogDiffJson
      ? (JSON.parse(String(r.pendingCatalogDiffJson)) as UpstreamCatalogDiff)
      : null,
    state: String(r.state) as UpstreamState,
    createdAt: String(r.createdAt),
    updatedAt: String(r.updatedAt),
  };
}
