import type { IncomingMessage, ServerResponse } from 'node:http';

export async function readText(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > 1024 * 1024) throw new Error('MCP request too large');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function readJson(req: IncomingMessage) {
  const text = await readText(req);
  return text ? JSON.parse(text) : {};
}

export async function readOAuthParams(req: IncomingMessage) {
  const text = await readText(req);
  const contentType = String(req.headers['content-type'] ?? '');
  if (contentType.includes('application/json')) {
    const value = text ? JSON.parse(text) : {};
    const params = new URLSearchParams();
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        if (entry == null) continue;
        params.set(key, String(entry));
      }
    }
    return params;
  }
  return new URLSearchParams(text);
}

export function applyOAuthCors(res: ServerResponse) {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
  res.setHeader(
    'access-control-allow-headers',
    'Authorization, Content-Type, MCP-Protocol-Version, MCP-Session-Id',
  );
  res.setHeader('access-control-expose-headers', 'WWW-Authenticate, MCP-Session-Id');
  res.setHeader('access-control-max-age', '86400');
}

export function sendJson(res: ServerResponse, status: number, value: unknown) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(value));
}

export function sendHtml(res: ServerResponse, status: number, html: string) {
  res.statusCode = status;
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  applyOAuthCors(res);
  res.end(html);
}

export function sendOAuthJson(res: ServerResponse, status: number, value: unknown) {
  res.setHeader('cache-control', 'no-store');
  applyOAuthCors(res);
  sendJson(res, status, value);
}

export function remoteIp(req: IncomingMessage): string {
  return typeof req.headers['cf-connecting-ip'] === 'string'
    ? req.headers['cf-connecting-ip']
    : (req.socket.remoteAddress ?? 'unknown');
}

export function bearerToken(req: IncomingMessage) {
  const value = req.headers.authorization;
  if (typeof value !== 'string') return undefined;
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim();
}

export function htmlEscape(value: unknown) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  );
}
