import type { IncomingMessage } from 'node:http';
import { DEFAULT_TRANSFER_LIMITS } from '../../../../packages/protocol/src/file-transfer.js';
import { MCP_BODY_BYTES, readJsonSized, tooLarge } from './http-response.js';

/**
 * Two-stage body cap for an authenticated MCP POST. Up to the inline transfer limit (as
 * base64) plus 1 MiB is read; beyond 1 MiB only a `files_download` call may be that big.
 */
export async function readMcpBody(req: IncomingMessage, inlineLimitBytes?: number) {
  const inline = Number(inlineLimitBytes) || DEFAULT_TRANSFER_LIMITS.inlineMb * 1024 * 1024;
  const ceiling = Math.ceil((inline * 4) / 3) + MCP_BODY_BYTES;
  if (Number(req.headers['content-length']) > ceiling) throw tooLarge();
  const { body, size } = await readJsonSized(req, ceiling);
  const transfer = body?.method === 'tools/call' && body?.params?.name === 'files_download';
  if (size > MCP_BODY_BYTES && !transfer) throw tooLarge();
  return body;
}
