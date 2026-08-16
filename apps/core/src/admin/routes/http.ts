import type { IncomingMessage, ServerResponse } from 'node:http';

export function sendAdminResponse(
  response: ServerResponse,
  status: number,
  value: unknown,
  contentType = 'application/json',
): void {
  response.statusCode = status;
  response.setHeader('content-type', contentType);
  response.end(contentType === 'application/json' ? JSON.stringify(value) : String(value));
}

export async function readAdminBody(request: IncomingMessage): Promise<Record<string, any>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > 1024 * 1024) {
      throw Object.assign(new Error('request body too large'), { status: 413 });
    }
    chunks.push(buffer);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('invalid JSON'), { status: 400 });
  }
}
