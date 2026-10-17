import type { IncomingMessage, ServerResponse } from 'node:http';

type ListenerHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

/**
 * Parses an origin-form request target. Anything that does not start with exactly one
 * `/` (`//host`, `/\host`, absolute-form, `*`) is refused: WHATWG URL parsing treats a
 * leading `//` or `/\` as a scheme-relative authority and throws or re-targets the host.
 */
export function parseRequestTarget(target: string | undefined, base: string): URL | undefined {
  const value = target ?? '/';
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return undefined;
  try {
    const parsed = new URL(value, base);
    if (parsed.origin !== new URL(base).origin || parsed.pathname.startsWith('//'))
      return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

export function rejectBadRequestTarget(res: ServerResponse) {
  res.statusCode = 400;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ error: { code: 'BAD_REQUEST', message: 'Invalid request target' } }));
}

/** Answers a request whose handler threw, or drops the socket if a response already started. */
export function failRequest(res: ServerResponse, error: unknown) {
  try {
    if (res.writableEnded) return;
    if (res.headersSent) {
      res.destroy();
      return;
    }
    const raw = (error as { status?: unknown } | null)?.status;
    const status = typeof raw === 'number' && raw >= 400 && raw < 500 ? raw : 500;
    res.statusCode = status;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: status === 500 ? 'internal error' : 'bad request' }));
  } catch {
    res.destroy();
  }
}

/**
 * Adapts an async handler to a node listener. A rejected handler must never escape as an
 * unhandled rejection: Node exits the process on one, so any unauthenticated request that
 * throws would take the whole core down.
 */
export function guardListener(handle: ListenerHandler) {
  return (req: IncomingMessage, res: ServerResponse) => {
    let pending: Promise<void>;
    try {
      pending = handle(req, res);
    } catch (error) {
      failRequest(res, error);
      return;
    }
    pending.catch((error: unknown) => failRequest(res, error));
  };
}

/** Forbids framing so a page on another origin cannot overlay or clickjack the Admin UI. */
export function applyFrameDenyHeaders(res: ServerResponse) {
  res.setHeader('content-security-policy', "frame-ancestors 'none'");
  res.setHeader('x-frame-options', 'DENY');
}
