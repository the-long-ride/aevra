import type { RiskTier } from '../../protocol/src/index.js';
import { redactText } from '../../security/src/dlp.js';
import { markUntrusted } from '../../security/src/untrusted.js';
import { authorizeCapability } from './authorization.js';
import { AevraToolError } from './errors.js';
import type { McpProxyOperation, McpRuntimeContext } from './service-types.js';
import { proxyName, splitProxyName, splitProxyResourceUri } from './upstream-names.js';
import type { UpstreamRegistryService, UpstreamServerSummary } from './upstream-port.js';

function registry(context: McpRuntimeContext): UpstreamRegistryService | undefined {
  return context.deps.upstreams;
}

function resolveServer(context: McpRuntimeContext, server: string): UpstreamServerSummary {
  const summary = registry(context)?.findByName(server) ?? null;
  if (!summary || !summary.enabled) {
    throw new AevraToolError('CAPABILITY_REQUIRED', `MCP server ${server} is not enabled`);
  }
  if (summary.state === 'needs-review') {
    throw new AevraToolError(
      'CAPABILITY_REQUIRED',
      `MCP server ${server} changed its catalog and is awaiting operator review`,
    );
  }
  return summary;
}

function redactDeep(value: unknown, tally: { count: number }): unknown {
  if (typeof value === 'string') {
    const scanned = redactText(value);
    tally.count += scanned.redactionCount;
    return scanned.text;
  }
  if (Array.isArray(value)) return value.map((item) => redactDeep(item, tally));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      const scannedKey = redactText(key);
      tally.count += scannedKey.redactionCount;
      out[scannedKey.text] = redactDeep(nested, tally);
    }
    return out;
  }
  return value;
}

function auditProxy(
  context: McpRuntimeContext,
  sessionId: string,
  server: string,
  entry: string,
  risk: RiskTier,
  result: 'SUCCEEDED' | 'FAILED' | 'PENDING',
  decision: 'allow' | 'approval',
  redactionCount: number,
) {
  const lease = context.sessions.activeLease(sessionId);
  context.deps.audit?.append({
    sessionId,
    ...(lease ? { workspaceId: lease.workspaceId } : {}),
    tool: proxyName(server, entry),
    operation: `mcp:${server}:${entry}`,
    target: server,
    risk,
    decision,
    result,
    redactionCount,
  });
}

function toolErrorFor(error: unknown): AevraToolError {
  if (error instanceof AevraToolError) return error;
  const code = (error as { code?: unknown } | null)?.code;
  const message = redactText(error instanceof Error ? error.message : String(error)).text;
  if (typeof code === 'string' && code.startsWith('UPSTREAM_')) {
    return new AevraToolError('EXECUTOR_UNAVAILABLE', message, { upstreamCode: code });
  }
  return new AevraToolError('INVALID_REQUEST', message);
}

async function proxied(
  context: McpRuntimeContext,
  sessionId: string,
  server: UpstreamServerSummary,
  entry: string,
  args: unknown,
  operation: McpProxyOperation,
  invoke: () => Promise<unknown>,
) {
  const gate = await authorizeCapability(
    context,
    sessionId,
    'mcp.proxy',
    {
      tool:
        operation.kind === 'resource'
          ? operation.uri
          : operation.kind === 'tool'
            ? operation.name
            : operation.name,
      args,
      proxy: operation,
    },
    `mcp:${server.name}:${entry}`,
    server.risk,
  );
  if ('response' in gate) {
    auditProxy(context, sessionId, server.name, entry, server.risk, 'PENDING', 'approval', 0);
    return gate.response;
  }

  let value: unknown;
  try {
    value = await invoke();
  } catch (error) {
    auditProxy(context, sessionId, server.name, entry, server.risk, 'FAILED', 'allow', 0);
    throw toolErrorFor(error);
  }
  const payload =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : { result: value };
  const tally = { count: 0 };
  const redacted = redactDeep(payload, tally) as Record<string, unknown>;
  auditProxy(
    context,
    sessionId,
    server.name,
    entry,
    server.risk,
    'SUCCEEDED',
    'allow',
    tally.count,
  );
  return markUntrusted(redacted);
}

export async function callUpstreamTool(
  context: McpRuntimeContext,
  sessionId: string,
  publicName: string,
  args: any,
) {
  const ref = splitProxyName(publicName);
  if (!ref) throw new AevraToolError('CAPABILITY_REQUIRED', `Tool ${publicName} is not enabled`);
  const server = resolveServer(context, ref.server);
  return proxied(
    context,
    sessionId,
    server,
    ref.entry,
    args,
    { kind: 'tool', name: publicName, args },
    () => registry(context)!.callTool(server.name, ref.entry, args),
  );
}

export async function readUpstreamResource(
  context: McpRuntimeContext,
  sessionId: string,
  publicUri: string,
) {
  const ref = splitProxyResourceUri(publicUri);
  if (!ref) throw new AevraToolError('INVALID_REQUEST', 'Unknown resource URI');
  const server = resolveServer(context, ref.server);
  const result = await proxied(
    context,
    sessionId,
    server,
    ref.entry,
    { uri: publicUri },
    { kind: 'resource', uri: publicUri },
    () => registry(context)!.readResource(server.name, ref.entry),
  );
  return { ...(result as Record<string, unknown>), uri: publicUri };
}

export async function getUpstreamPrompt(
  context: McpRuntimeContext,
  sessionId: string,
  publicName: string,
  args: unknown,
) {
  const ref = splitProxyName(publicName);
  if (!ref) throw new AevraToolError('INVALID_REQUEST', `Unknown prompt ${publicName}`);
  const server = resolveServer(context, ref.server);
  return proxied(
    context,
    sessionId,
    server,
    ref.entry,
    args,
    { kind: 'prompt', name: publicName, args },
    () => registry(context)!.getPrompt(server.name, ref.entry, args),
  );
}
