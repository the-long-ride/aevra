import { UpstreamError, type UpstreamServerInfo } from './protocol.js';

export const DEFAULT_DEADLINE_MS = 30_000;

export function safeHttpUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new UpstreamError('UPSTREAM_PROTOCOL', 'The upstream URL is invalid');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new UpstreamError('UPSTREAM_PROTOCOL', 'The upstream URL must use http or https');
  if (url.username || url.password)
    throw new UpstreamError('UPSTREAM_PROTOCOL', 'Credentials in upstream URLs are not allowed');
  return url;
}

export async function fetchSameOrigin(
  value: string,
  init: RequestInit,
  maxRedirects = 5,
): Promise<Response> {
  const base = safeHttpUrl(value);
  let current = base.toString();
  for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
    const response = await fetch(current, { ...init, redirect: 'manual' });
    if (response.status < 300 || response.status > 399) return response;
    const location = response.headers.get('location');
    if (!location)
      throw new UpstreamError('UPSTREAM_CONNECT_FAILED', 'The upstream redirect has no location');
    const next = safeHttpUrl(new URL(location, current).toString());
    if (next.origin !== base.origin)
      throw new UpstreamError(
        'UPSTREAM_CONNECT_FAILED',
        'The upstream redirected a credential-bearing request to another origin',
      );
    current = next.toString();
  }
  throw new UpstreamError('UPSTREAM_CONNECT_FAILED', 'The upstream redirected too many times');
}

export interface UpstreamTransport {
  connect(): Promise<UpstreamServerInfo>;
  request(method: string, params?: unknown): Promise<unknown>;
  close(): Promise<void>;
  onNotification(handler: (method: string, params: unknown) => void): void;
  onClose?(handler: () => void): void;
}

export class EventStreamParser {
  private buffer = '';
  private pendingCarriageReturn = false;

  push(chunk: string, onEvent: (event: string) => void): void {
    this.buffer += this.normalize(chunk);
    this.drain(onEvent);
  }

  finish(onEvent: (event: string) => void): void {
    if (this.pendingCarriageReturn) {
      this.buffer += '\n';
      this.pendingCarriageReturn = false;
    }
    this.drain(onEvent);
  }

  private normalize(chunk: string): string {
    let normalized = '';
    for (const character of chunk) {
      if (this.pendingCarriageReturn) {
        if (character === '\n') {
          normalized += '\n';
          this.pendingCarriageReturn = false;
          continue;
        }
        normalized += '\n';
        this.pendingCarriageReturn = false;
      }
      if (character === '\r') this.pendingCarriageReturn = true;
      else normalized += character;
    }
    return normalized;
  }

  private drain(onEvent: (event: string) => void): void {
    let split = this.buffer.indexOf('\n\n');
    while (split !== -1) {
      const event = this.buffer.slice(0, split);
      this.buffer = this.buffer.slice(split + 2);
      onEvent(event);
      split = this.buffer.indexOf('\n\n');
    }
  }
}

export type UpstreamTransportConfig =
  | {
      transport: 'stdio';
      command: string;
      args: string[];
      cwd?: string;
      env?: Record<string, string>;
    }
  | { transport: 'http'; url: string; headers?: Record<string, string> }
  | { transport: 'sse'; url: string; headers?: Record<string, string> };
