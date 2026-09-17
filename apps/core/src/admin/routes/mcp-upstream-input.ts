import type { RiskTier } from '../../../../../packages/protocol/src/index.js';
import type {
  UpstreamRecord,
  UpstreamState,
  UpstreamTransportKind,
} from '../../mcp-upstream/upstream-records.js';

export const UPSTREAM_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;
const TRANSPORTS: UpstreamTransportKind[] = ['stdio', 'http', 'sse'];
const RISKS: RiskTier[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const SECRET_REF_PATTERN = /^sr_[A-Za-z0-9._-]{1,64}$/;
const HEADER_NAME_PATTERN = /^[A-Za-z0-9-]{1,64}$/;
const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

export class UpstreamInputError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'UpstreamInputError';
  }
}
function fail(code: string, message: string): never {
  throw new UpstreamInputError(code, message);
}

function parseConfig(transport: UpstreamTransportKind, value: any) {
  const config = (value ?? {}) as Record<string, unknown>;
  if (transport === 'stdio') {
    const command = String(config.command ?? '').trim();
    if (!command) fail('UPSTREAM_CONFIG_INVALID', 'A stdio server needs a command to run');
    const args = Array.isArray(config.args) ? config.args.map(String) : [];
    const cwd = typeof config.cwd === 'string' && config.cwd ? config.cwd : undefined;
    return cwd === undefined ? { command, args } : { command, args, cwd };
  }
  const url = String(config.url ?? '').trim();
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return fail('UPSTREAM_CONFIG_INVALID', 'An HTTP or SSE server needs a valid URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
    fail('UPSTREAM_CONFIG_INVALID', 'An upstream URL must be http or https');
  return { url };
}

function secretRef(value: unknown): string {
  const id = String(value ?? '');
  if (!SECRET_REF_PATTERN.test(id))
    fail(
      'UPSTREAM_SECRET_VALUE_REJECTED',
      'Credentials must be given as a secret reference id (sr_...), never as a value',
    );
  return id;
}

function parseAuth(transport: UpstreamTransportKind, value: any) {
  if (value === undefined || value === null) return { kind: 'none' as const };
  const auth = value as Record<string, unknown>;
  if (auth.value !== undefined || auth.token !== undefined || auth.secret !== undefined)
    fail(
      'UPSTREAM_SECRET_VALUE_REJECTED',
      'Credentials must be given as a secret reference id (sr_...), never as a value',
    );
  if (transport === 'stdio') {
    const env = (auth.env ?? {}) as Record<string, unknown>;
    const entries = Object.entries(env);
    if (!entries.length) return { kind: 'none' as const };
    const resolved: Record<string, string> = {};
    for (const [name, reference] of entries) {
      if (!ENV_NAME_PATTERN.test(name))
        fail('UPSTREAM_CONFIG_INVALID', `${name} is not a usable environment variable name`);
      resolved[name] = secretRef(reference);
    }
    return { kind: 'env' as const, env: resolved };
  }
  if (auth.header === undefined && auth.secretRefId === undefined) return { kind: 'none' as const };
  const header = String(auth.header ?? '').trim();
  if (!HEADER_NAME_PATTERN.test(header))
    fail('UPSTREAM_CONFIG_INVALID', 'An auth header name may only contain letters, digits and -');
  return { kind: 'header' as const, header, secretRefId: secretRef(auth.secretRefId) };
}

export function parseUpstreamInput(body: Record<string, any>) {
  const name = String(body.name ?? '').trim();
  if (!UPSTREAM_NAME_PATTERN.test(name))
    fail(
      'UPSTREAM_NAME_INVALID',
      'A server name must be lowercase letters, digits and dashes, up to 32 characters',
    );
  const transport = String(body.transport ?? '') as UpstreamTransportKind;
  if (!TRANSPORTS.includes(transport))
    fail('UPSTREAM_TRANSPORT_INVALID', 'Transport must be stdio, http or sse');
  const risk = String(body.risk ?? '') as RiskTier;
  if (!RISKS.includes(risk))
    fail('UPSTREAM_RISK_INVALID', 'Risk tier must be LOW, MEDIUM, HIGH or CRITICAL');
  return {
    name,
    transport,
    config: parseConfig(transport, body.config),
    auth: parseAuth(transport, body.auth),
    risk,
    enabled: body.enabled === undefined ? true : body.enabled === true,
  };
}

export interface PublicUpstream {
  id: string;
  name: string;
  transport: UpstreamTransportKind;
  config: unknown;
  auth: unknown;
  risk: RiskTier;
  enabled: boolean;
  state: UpstreamState;
  toolCount: number;
  resourceCount: number;
  promptCount: number;
  pendingCatalogDiff: { added: string[]; removed: string[]; changed: string[] } | null;
  advisory: Array<{ tool: string; readOnlyHint?: boolean; destructiveHint?: boolean }>;
  createdAt: string;
  updatedAt: string;
}

export type ProjectableUpstream = UpstreamRecord &
  Partial<Pick<PublicUpstream, 'toolCount' | 'resourceCount' | 'promptCount' | 'advisory'>>;

export function publicUpstream(record: ProjectableUpstream): PublicUpstream {
  const catalog = record.pendingCatalog ?? record.catalog;
  const tools = catalog?.tools ?? [];
  const advisory =
    record.advisory ??
    tools.flatMap((tool) =>
      tool.annotations
        ? [
            {
              tool: tool.name,
              ...(tool.annotations.readOnlyHint === undefined
                ? {}
                : { readOnlyHint: tool.annotations.readOnlyHint }),
              ...(tool.annotations.destructiveHint === undefined
                ? {}
                : { destructiveHint: tool.annotations.destructiveHint }),
            },
          ]
        : [],
    );
  return {
    id: record.id,
    name: record.name,
    transport: record.transport,
    config: record.config,
    auth: record.auth,
    risk: record.risk,
    enabled: record.enabled,
    state: record.state,
    toolCount: Number(record.toolCount ?? tools.length),
    resourceCount: Number(record.resourceCount ?? catalog?.resources.length ?? 0),
    promptCount: Number(record.promptCount ?? catalog?.prompts.length ?? 0),
    pendingCatalogDiff: record.pendingCatalogDiff ?? null,
    advisory,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}
