import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer, type ServerResponse } from 'node:http';
import { httpTransport } from '../src/stdio-http.js';

async function serve(reply: (res: ServerResponse) => void) {
  const server = createServer((req, res) => {
    req.resume();
    req.on('end', () => reply(res));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}/mcp`;
  const transport = httpTransport({ version: 1, id: 'c', token: 'plain-word-value', endpoint });
  const close = async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };
  return { transport, close };
}

const send = (transport: ReturnType<typeof httpTransport>, frames: unknown[]) =>
  transport.send(
    { jsonrpc: '2.0', id: 1, method: 'tools/call' },
    async (frame) => {
      frames.push(frame);
    },
    new AbortController().signal,
  );

test('a plain response over the frame limit is refused, counted across many chunks', async () => {
  const piece = Buffer.alloc(64 * 1024, 0x20);
  const { transport, close } = await serve((res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    for (let sent = 0; sent <= 8 * 1024 * 1024; sent += piece.length) res.write(piece);
    res.end();
  });
  try {
    await assert.rejects(send(transport, []), /MCP response exceeds frame limit/);
  } finally {
    await close();
  }
});

test('SSE events split inside a CRLF pair still arrive whole', async () => {
  const first = JSON.stringify({ jsonrpc: '2.0', id: 1, result: { text: 'first words' } });
  const second = JSON.stringify({ jsonrpc: '2.0', method: 'notice', params: { n: 2 } });
  const { transport, close } = await serve((res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(`data: ${first}\r`);
    setTimeout(() => res.write('\n\r'), 5);
    setTimeout(() => res.end(`\ndata: ${second}\r\n\r\n`), 10);
  });
  const frames: any[] = [];
  try {
    await send(transport, frames);
    assert.deepEqual(frames, [JSON.parse(first), JSON.parse(second)]);
  } finally {
    await close();
  }
});
