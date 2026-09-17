/** Wire-level shapes used by the hand-rolled MCP upstream client. */

export const MCP_PROTOCOL_VERSION = '2025-06-18';

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

export type JsonRpcMessage =
  | { type: 'response'; response: JsonRpcResponse }
  | { type: 'notification'; notification: JsonRpcNotification };

export type UpstreamErrorCode =
  | 'UPSTREAM_CONNECT_FAILED'
  | 'UPSTREAM_TIMEOUT'
  | 'UPSTREAM_DIED'
  | 'UPSTREAM_PROTOCOL'
  | 'UPSTREAM_CALL_FAILED';

export class UpstreamError extends Error {
  constructor(
    readonly code: UpstreamErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'UpstreamError';
  }
}

export function parseJsonRpcMessage(line: string): JsonRpcMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (record.jsonrpc !== '2.0') return null;
  if (typeof record.id === 'number') {
    if (!Number.isSafeInteger(record.id)) return null;
    const hasResult = Object.hasOwn(record, 'result');
    const hasError = Object.hasOwn(record, 'error');
    if (hasResult === hasError) return null;
    if (hasError) {
      const error = record.error;
      if (!error || typeof error !== 'object' || Array.isArray(error)) return null;
      const fields = error as Record<string, unknown>;
      if (!Number.isInteger(fields.code) || typeof fields.message !== 'string') return null;
    }
    return { type: 'response', response: record as unknown as JsonRpcResponse };
  }
  if (!Object.hasOwn(record, 'id') && typeof record.method === 'string') {
    return { type: 'notification', notification: record as unknown as JsonRpcNotification };
  }
  return null;
}

export interface UpstreamServerInfo {
  name: string;
  version: string;
  protocolVersion: string;
  capabilities: Record<string, unknown>;
}

export interface UpstreamTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
}

export interface UpstreamResource {
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
}

export interface UpstreamPrompt {
  name: string;
  description?: string;
  arguments?: unknown[];
}

export interface UpstreamCatalog {
  tools: UpstreamTool[];
  resources: UpstreamResource[];
  prompts: UpstreamPrompt[];
}
