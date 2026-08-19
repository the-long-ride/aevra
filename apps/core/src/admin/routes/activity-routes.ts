import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendAdminResponse } from './http.js';
import type { AdminApiContext } from './types.js';

function writeActivity(res: ServerResponse, entry: unknown) {
  res.write(`event: activity\ndata: ${JSON.stringify(entry)}\n\n`);
}

export function handleActivityRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  context: AdminApiContext,
): boolean {
  if (url.pathname !== '/api/activity/stream') return false;
  if (req.method !== 'GET') {
    sendAdminResponse(res, 405, {
      error: { code: 'METHOD_NOT_ALLOWED', message: 'Activity stream requires GET' },
    });
    return true;
  }
  if (!context.activity) {
    sendAdminResponse(res, 503, {
      error: { code: 'ACTIVITY_UNAVAILABLE', message: 'MCP activity stream is unavailable' },
    });
    return true;
  }

  res.statusCode = 200;
  res.setHeader('content-type', 'text/event-stream; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.setHeader('connection', 'keep-alive');
  res.setHeader('x-accel-buffering', 'no');
  res.flushHeaders?.();

  for (const entry of context.activity.recent(100)) writeActivity(res, entry);
  const unsubscribe = context.activity.subscribe((entry: unknown) => writeActivity(res, entry));
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(': keepalive\n\n');
  }, 15_000);
  heartbeat.unref?.();

  let closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    unsubscribe();
  };
  req.once('close', cleanup);
  res.once?.('close', cleanup);
  return true;
}
