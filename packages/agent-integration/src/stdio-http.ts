import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { readFileSync } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';
import type { StdioTransport } from './stdio.js';

const FRAME_LIMIT = 8 * 1024 * 1024;
const REOPEN_TIMEOUT_MS = 30_000;

export interface LocalCredential {
  version: number;
  id: string;
  token: string;
  endpoint: string;
  caFile?: string;
}
export function readCredential(file: string): LocalCredential {
  const value = JSON.parse(readFileSync(file, 'utf8')) as LocalCredential;
  const url = new URL(value.endpoint);
  if (
    value.version !== 1 ||
    typeof value.token !== 'string' ||
    !value.token ||
    !['http:', 'https:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== '/mcp' ||
    url.search ||
    url.hash
  )
    throw new Error('AGENT_CREDENTIAL_INVALID: expected authenticated loopback MCP endpoint');
  return value;
}

// Accumulates a response body. `bytes` is the UTF-8 size of `text`, kept as a running count so
// each chunk is measured once. For SSE, CRLF is folded on the new text only; a `\r` that ends a
// chunk is held back, since it may be the first half of a CRLF split across chunks.
function bodyBuffer(sse: boolean) {
  const state = { text: '', bytes: 0 };
  let carriage = false;
  return Object.assign(state, {
    append(value: string) {
      let piece = value;
      if (sse) {
        if (carriage) piece = `\r${piece}`;
        carriage = piece.endsWith('\r');
        if (carriage) piece = piece.slice(0, -1);
        piece = piece.replaceAll('\r\n', '\n');
      }
      state.text += piece;
      state.bytes += Buffer.byteLength(piece);
    },
    // Removes and returns the next complete SSE event, searching from `from` onwards.
    take(from: number): string | null {
      const boundary = state.text.indexOf('\n\n', from);
      if (boundary < 0) return null;
      const event = state.text.slice(0, boundary);
      state.text = state.text.slice(boundary + 2);
      state.bytes -= Buffer.byteLength(event) + 2;
      return event;
    },
  });
}

// Core answers 404 to a session id it no longer knows: sessions live in memory, so a restart
// forgets every one of them.
class SessionExpired extends Error {}

type Emit = (message: unknown) => Promise<void>;
const discard: Emit = async () => undefined;

export function httpTransport(credential: LocalCredential, ca?: Buffer): StdioTransport {
  let session: string | undefined, protocol: string | undefined;
  // The client's own handshake, replayed to open a new session after core restarts.
  let initialize: Record<string, unknown> | undefined, initialized: unknown;
  let resuming: Promise<void> | null = null,
    reopened = 0;
  const post = (text: string, signal: AbortSignal) => {
    const url = new URL(credential.endpoint);
    const headers: Record<string, string> = {
      authorization: `Bearer ${credential.token}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'content-length': String(Buffer.byteLength(text)),
    };
    if (session) headers['mcp-session-id'] = session;
    if (protocol) headers['mcp-protocol-version'] = protocol;
    return new Promise<IncomingMessage>((resolve, reject) => {
      const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
        url,
        { method: 'POST', headers, signal, ...(ca ? { ca } : {}), rejectUnauthorized: true },
        resolve,
      );
      request.once('error', reject);
      request.end(text);
    });
  };
  const exchange = async (message: unknown, emit: Emit, signal: AbortSignal) => {
    const sent = session;
    const response = await post(JSON.stringify(message), signal);
    if (typeof response.headers['mcp-session-id'] === 'string')
      session = response.headers['mcp-session-id'];
    if ((response.statusCode ?? 500) >= 400) {
      response.resume();
      if (response.statusCode === 404 && sent) throw new SessionExpired(sent);
      throw new Error(`MCP HTTP ${response.statusCode}`);
    }
    const deliver = async (data: string) => {
      if (!data.trim() || data === '[DONE]') return;
      const frame = JSON.parse(data);
      if ((message as any)?.method === 'initialize' && frame.result?.protocolVersion)
        protocol = frame.result.protocolVersion;
      await emit(frame);
    };
    const sse = String(response.headers['content-type']).includes('text/event-stream');
    const buffer = bodyBuffer(sse);
    const decoder = new StringDecoder('utf8');
    for await (const chunk of response) {
      // A boundary can straddle the old and the new text, so search from one character back.
      let from = Math.max(0, buffer.text.length - 1);
      buffer.append(decoder.write(chunk));
      if (buffer.bytes > FRAME_LIMIT) {
        response.destroy();
        throw new Error('MCP response exceeds frame limit');
      }
      if (!sse) continue;
      for (let event = buffer.take(from); event !== null; event = buffer.take(from)) {
        from = 0;
        await deliver(
          event
            .split('\n')
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trimStart())
            .join('\n'),
        );
      }
    }
    buffer.append(decoder.end());
    if (!sse) await deliver(buffer.text);
  };
  // One reopening at a time; requests that hit the same stale id wait for it and then retry.
  // It has its own time limit, not the triggering request's signal: a cancelled request must not
  // abort the handshake every later request depends on.
  const reopen = (stale: string): Promise<void> => {
    if (resuming) return resuming;
    if (session !== stale) return Promise.resolve();
    const before = { session, protocol };
    session = protocol = undefined;
    resuming = (async () => {
      const signal = AbortSignal.timeout(REOPEN_TIMEOUT_MS);
      const id = `aevra-bridge-reinitialize-${++reopened}`;
      await exchange({ ...initialize, id }, discard, signal);
      if (initialized) await exchange(initialized, discard, signal);
    })()
      .catch((error: unknown) => {
        // Back to the stale id, so the next request meets 404 again and retries the reopen
        // (no session id at all would get a 400 that is never retried).
        ({ session, protocol } = before);
        throw error;
      })
      .finally(() => {
        resuming = null;
      });
    return resuming;
  };
  return {
    async send(message, emit, signal) {
      const method = (message as { method?: unknown } | null)?.method;
      if (method === 'initialize') initialize = message as Record<string, unknown>;
      if (method === 'notifications/initialized') initialized = message;
      if (resuming) await resuming;
      try {
        await exchange(message, emit, signal);
      } catch (error) {
        if (!(error instanceof SessionExpired) || method === 'initialize' || !initialize)
          throw error;
        await reopen(error.message);
        await exchange(message, emit, signal);
      }
    },
  };
}
