import type { IncomingMessage } from 'node:http';
import { aevraServerInfo } from './server-info.js';

export const MODERN_PROTOCOL_VERSION = '2026-07-28';
const CACHE_TTL_MS = 60_000;
const NAMED_METHODS = new Set(['tools/call', 'resources/read', 'prompts/get']);
const CACHEABLE_METHODS = new Set([
  'tools/list',
  'resources/list',
  'resources/read',
  'resources/templates/list',
  'prompts/list',
]);

export class ModernProtocolError extends Error {
  constructor(
    message: string,
    readonly code = -32020,
    readonly data?: Record<string, unknown>,
  ) {
    super(message);
    this.name = code === -32022 ? 'UnsupportedProtocolVersion' : 'HeaderMismatch';
  }
}

function header(req: IncomingMessage, name: string) {
  const value = req.headers[name.toLowerCase()];
  return typeof value === 'string' ? value.trim() : undefined;
}

function protocolMeta(body: any) {
  const value = body?.params?._meta?.['io.modelcontextprotocol/protocolVersion'];
  return typeof value === 'string' ? value.trim() : undefined;
}

function decodeHeaderValue(value: string) {
  if (!value.startsWith('=?base64?') || !value.endsWith('?=')) return value;
  const encoded = value.slice('=?base64?'.length, -2);
  if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new ModernProtocolError('Invalid base64-encoded MCP header value');
  }
  const decoded = Buffer.from(encoded, 'base64');
  if (decoded.toString('base64') !== encoded) {
    throw new ModernProtocolError('Invalid base64-encoded MCP header value');
  }
  return decoded.toString('utf8');
}

function bodyName(body: any) {
  if (body?.method === 'resources/read') return body?.params?.uri;
  return body?.params?.name;
}

export function isModernRequest(req: IncomingMessage, body: any) {
  return (
    header(req, 'mcp-protocol-version') === MODERN_PROTOCOL_VERSION ||
    protocolMeta(body) === MODERN_PROTOCOL_VERSION ||
    body?.method === 'server/discover'
  );
}

export function validateModernRequest(req: IncomingMessage, body: any) {
  const protocol = header(req, 'mcp-protocol-version');
  if (protocol !== MODERN_PROTOCOL_VERSION) {
    if (body?.method === 'server/discover' && protocol) {
      throw new ModernProtocolError('Unsupported protocol version', -32022, {
        supported: [MODERN_PROTOCOL_VERSION],
        requested: protocol,
      });
    }
    throw new ModernProtocolError(`MCP-Protocol-Version must be ${MODERN_PROTOCOL_VERSION}`);
  }
  if (protocolMeta(body) !== MODERN_PROTOCOL_VERSION) {
    throw new ModernProtocolError('Protocol version header does not match request _meta');
  }
  const method = header(req, 'mcp-method');
  if (!method || method !== body?.method) {
    throw new ModernProtocolError('Mcp-Method header does not match request method');
  }
  if (NAMED_METHODS.has(body?.method)) {
    const rawName = header(req, 'mcp-name');
    const expected = bodyName(body);
    if (!rawName || typeof expected !== 'string' || decodeHeaderValue(rawName) !== expected) {
      throw new ModernProtocolError('Mcp-Name header does not match request name');
    }
  }
}

function serverMeta(baseUrl?: string, existing?: Record<string, unknown>) {
  return {
    ...(existing ?? {}),
    'io.modelcontextprotocol/serverInfo': aevraServerInfo(baseUrl),
  };
}

export function modernDiscoverResult(baseUrl?: string) {
  return {
    resultType: 'complete',
    supportedVersions: [MODERN_PROTOCOL_VERSION],
    capabilities: {
      tools: { listChanged: false },
      resources: { listChanged: false },
      prompts: { listChanged: false },
    },
    instructions: aevraServerInfo(baseUrl).description,
    ttlMs: CACHE_TTL_MS,
    cacheScope: 'public',
    _meta: serverMeta(baseUrl),
  };
}

function compareOrdinal(left: unknown, right: unknown) {
  const a = String(left ?? '');
  const b = String(right ?? '');
  return a < b ? -1 : a > b ? 1 : 0;
}

export function decorateModernResult(response: any, method?: string, baseUrl?: string) {
  if (!response?.result || response?.error) return response;
  const result = { ...response.result };
  result.resultType ??= 'complete';
  result._meta = serverMeta(baseUrl, result._meta);
  if (CACHEABLE_METHODS.has(method ?? '')) {
    result.ttlMs ??= CACHE_TTL_MS;
    result.cacheScope ??= 'private';
  }
  if (method === 'tools/list' && Array.isArray(result.tools)) {
    result.tools = [...result.tools].sort((a, b) => compareOrdinal(a?.name, b?.name));
  }
  return { ...response, result };
}
