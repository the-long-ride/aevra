import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface FakeMcpServer {
  url: string;
  sseUrl: string;
  requests: Array<{ method: string; headers: Record<string, string> }>;
  close(): Promise<void>;
}

function reply(request: { id?: number; method: string }): unknown | null {
  if (request.method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id: request.id,
      result: {
        protocolVersion: '2025-06-18',
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: 'fake-http', version: '2.0.0' },
      },
    };
  }
  if (request.method === 'notifications/initialized') return null;
  if (request.method === 'never/answered') return null;
  if (request.method === 'tools/list') {
    return {
      jsonrpc: '2.0',
      id: request.id,
      result: {
        tools: [{ name: 'lookup', description: 'Looks up', inputSchema: { type: 'object' } }],
      },
    };
  }
  return {
    jsonrpc: '2.0',
    id: request.id,
    error: { code: -32601, message: `no method ${request.method}` },
  };
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

export async function startFakeMcpServer(): Promise<FakeMcpServer> {
  const requests: FakeMcpServer['requests'] = [];
  let sseResponse: ServerResponse | null = null;
  const server = createServer((request, response) => {
    const url = request.url ?? '/';
    if (request.method === 'GET' && url === '/sse') {
      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      sseResponse = response;
      response.write('event: endpoint\ndata: /sse/post\n\n');
      return;
    }
    if (request.method !== 'POST') {
      response.writeHead(405).end();
      return;
    }
    void readBody(request).then((body) => {
      const parsed = JSON.parse(body) as { id?: number; method: string };
      requests.push({
        method: parsed.method,
        headers: Object.fromEntries(
          Object.entries(request.headers).map(([key, value]) => [
            key,
            Array.isArray(value) ? value.join(',') : String(value ?? ''),
          ]),
        ),
      });
      const payload = reply(parsed);
      if (url.startsWith('/sse')) {
        response.writeHead(202).end();
        if (payload && sseResponse)
          sseResponse.write(`event: message\ndata: ${JSON.stringify(payload)}\n\n`);
        return;
      }
      if (!payload) {
        response.writeHead(202).end();
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'sess-1' });
      response.end(JSON.stringify(payload));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    sseUrl: `http://127.0.0.1:${port}/sse`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        sseResponse?.end();
        server.close(() => resolve());
      }),
  };
}
