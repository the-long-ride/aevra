import { HttpTransport } from './http-transport.js';
import { UpstreamError } from './protocol.js';
import { SseTransport } from './sse-transport.js';
import { StdioTransport } from './stdio-transport.js';
import type { UpstreamTransport, UpstreamTransportConfig } from './transport.js';

export function createTransport(
  config: UpstreamTransportConfig,
  deadlineMs?: number,
): UpstreamTransport {
  if (config.transport === 'stdio') {
    return new StdioTransport({ ...config, deadlineMs });
  }
  if (config.transport === 'http') {
    return new HttpTransport({ url: config.url, headers: config.headers, deadlineMs });
  }
  if (config.transport === 'sse') {
    return new SseTransport({ url: config.url, headers: config.headers, deadlineMs });
  }
  throw new UpstreamError(
    'UPSTREAM_PROTOCOL',
    `Unsupported upstream transport: ${String((config as { transport?: unknown }).transport)}`,
  );
}
