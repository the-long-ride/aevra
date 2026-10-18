import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson } from './http-response.js';
import { MODERN_PROTOCOL_VERSION } from './modern-protocol.js';

export const LEGACY_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'] as const;

function protocolHeader(req: IncomingMessage) {
  const value = req.headers['mcp-protocol-version'];
  return typeof value === 'string' ? value.trim() : undefined;
}

export function requestedProtocol(req: IncomingMessage, body: any) {
  const meta = body?.params?._meta?.['io.modelcontextprotocol/protocolVersion'];
  return protocolHeader(req) ?? (typeof meta === 'string' ? meta.trim() : undefined);
}

export function legacyProtocol(requested: unknown) {
  const value = typeof requested === 'string' ? requested : '';
  return LEGACY_PROTOCOL_VERSIONS.includes(value as any) ? value : LEGACY_PROTOCOL_VERSIONS[0];
}

export function unsupportedProtocol(res: ServerResponse, id: unknown, requested: string) {
  sendJson(res, 400, {
    jsonrpc: '2.0',
    id: id ?? null,
    error: {
      code: -32022,
      message: 'Unsupported protocol version',
      data: {
        supported: [MODERN_PROTOCOL_VERSION, ...LEGACY_PROTOCOL_VERSIONS],
        requested,
      },
    },
  });
}
