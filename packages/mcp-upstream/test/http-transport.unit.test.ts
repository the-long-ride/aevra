import assert from 'node:assert/strict';
import test from 'node:test';
import { HttpTransport } from '../src/http-transport.js';
import type { UpstreamError } from '../src/protocol.js';
import { startFakeMcpServer } from './fake-http-server.js';

for (const body of [
  { jsonrpc: '2.0', id: 999, result: {} },
  { jsonrpc: '1.0', id: 1, result: {} },
  { jsonrpc: '2.0', result: {} },
  { jsonrpc: '2.0', method: 'notification' },
  { jsonrpc: '2.0', id: 1 },
  { jsonrpc: '2.0', id: 1, result: {}, error: { code: -1, message: 'bad' } },
  { jsonrpc: '2.0', id: 1, error: { code: 'bad', message: 'bad' } },
]) {
  test(`HTTP rejects invalid response ${JSON.stringify(body)}`, async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify(body));
    const transport = new HttpTransport({ url: 'http://localhost/mcp' });
    try {
      await assert.rejects(
        transport.request('tools/list'),
        (error: UpstreamError) => error.code === 'UPSTREAM_PROTOCOL',
      );
    } finally {
      await transport.close();
      globalThis.fetch = original;
    }
  });
}

test('connect handshakes over POST and reports the server identity', async () => {
  const server = await startFakeMcpServer();
  const http = new HttpTransport({ url: server.url });
  try {
    const info = await http.connect();
    assert.equal(info.name, 'fake-http');
    assert.equal(info.version, '2.0.0');
    assert.deepEqual(info.capabilities, { tools: {}, resources: {} });
  } finally {
    await http.close();
    await server.close();
  }
});

test('the configured auth header is sent on every request', async () => {
  const server = await startFakeMcpServer();
  const http = new HttpTransport({ url: server.url, headers: { 'X-API-Key': 'k-123' } });
  try {
    await http.connect();
    await http.request('tools/list');
    assert.ok(server.requests.length >= 2);
    for (const request of server.requests) assert.equal(request.headers['x-api-key'], 'k-123');
  } finally {
    await http.close();
    await server.close();
  }
});

test('the session id the server assigns is echoed back on later requests', async () => {
  const server = await startFakeMcpServer();
  const http = new HttpTransport({ url: server.url });
  try {
    await http.connect();
    await http.request('tools/list');
    assert.equal(server.requests.at(-1)!.headers['mcp-session-id'], 'sess-1');
  } finally {
    await http.close();
    await server.close();
  }
});

test('a JSON-RPC error response rejects with UPSTREAM_CALL_FAILED', async () => {
  const server = await startFakeMcpServer();
  const http = new HttpTransport({ url: server.url });
  try {
    await http.connect();
    await assert.rejects(http.request('nope/nope'), (error: UpstreamError) => {
      assert.equal(error.code, 'UPSTREAM_CALL_FAILED');
      assert.match(error.message, /no method nope\/nope/);
      return true;
    });
  } finally {
    await http.close();
    await server.close();
  }
});

test('an unreachable url fails as UPSTREAM_CONNECT_FAILED without leaking the credential', async () => {
  const http = new HttpTransport({
    url: 'http://127.0.0.1:1/mcp',
    headers: { Authorization: 'Bearer super-secret' },
    deadlineMs: 500,
  });
  await assert.rejects(http.connect(), (error: UpstreamError) => {
    assert.equal(error.code, 'UPSTREAM_CONNECT_FAILED');
    const rendered = `${error.message} ${JSON.stringify(error.details ?? '')}`;
    assert.equal(rendered.includes('super-secret'), false);
    return true;
  });
});

test('a streamable HTTP event-stream response resolves its matching JSON-RPC result', async () => {
  const originalFetch = globalThis.fetch;
  let requestCount = 0;
  globalThis.fetch = (async (_input, init) => {
    requestCount += 1;
    const message = JSON.parse(String(init?.body)) as { id?: number; method: string };
    if (message.method === 'notifications/initialized') return new Response(null, { status: 202 });
    const result =
      message.method === 'initialize'
        ? {
            protocolVersion: '2025-06-18',
            serverInfo: { name: 'event-stream', version: '1' },
            capabilities: { tools: {} },
          }
        : { tools: [{ name: 'lookup' }] };
    return new Response(
      `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: message.id, result })}\n\n`,
      { headers: { 'content-type': 'text/event-stream' } },
    );
  }) as typeof fetch;
  try {
    const http = new HttpTransport({ url: 'https://upstream.example.test/mcp' });
    assert.equal((await http.connect()).name, 'event-stream');
    assert.deepEqual(await http.request('tools/list'), { tools: [{ name: 'lookup' }] });
    assert.equal(requestCount, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('HTTP event streams forward notifications and tolerate split CRLF frames', async () => {
  const originalFetch = globalThis.fetch;
  const encoder = new TextEncoder();
  let notification: { method: string; params: unknown } | null = null;
  globalThis.fetch = (async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as { id?: number; method: string };
    if (request.method === 'notifications/initialized') return new Response(null, { status: 202 });
    const result =
      request.method === 'initialize'
        ? {
            protocolVersion: '2025-06-18',
            serverInfo: { name: 'event-stream', version: '1' },
            capabilities: { tools: {} },
          }
        : { tools: [{ name: 'lookup' }] };
    const changed = {
      jsonrpc: '2.0',
      method: 'notifications/tools/list_changed',
      params: {},
    };
    const response = { jsonrpc: '2.0', id: request.id, result };
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('event: message\r'));
        controller.enqueue(encoder.encode(`\ndata: ${JSON.stringify(changed)}\r`));
        controller.enqueue(encoder.encode(`\n\r\ndata: ${JSON.stringify(response)}\r\n\r\n`));
        controller.close();
      },
    });
    return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
  }) as typeof fetch;
  try {
    const http = new HttpTransport({ url: 'https://upstream.example.test/mcp' });
    http.onNotification((method, params) => {
      notification = { method, params };
    });
    assert.equal((await http.connect()).name, 'event-stream');
    assert.deepEqual(await http.request('tools/list'), { tools: [{ name: 'lookup' }] });
    assert.deepEqual(notification, {
      method: 'notifications/tools/list_changed',
      params: {},
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('HTTP preserves multiline JSON data in normal CRLF events', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      'event: message\r\ndata: {"jsonrpc":"2.0",\r\ndata: "id":1,"result":{"ok":true}}\r\n\r\n',
      { headers: { 'content-type': 'text/event-stream' } },
    )) as typeof fetch;
  try {
    const http = new HttpTransport({ url: 'https://upstream.example.test/mcp' });
    assert.deepEqual(await http.request('tools/list'), { ok: true });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('closing HTTP aborts an in-flight request and rejects it', async () => {
  const originalFetch = globalThis.fetch;
  let resolveFetch: ((response: Response) => void) | undefined;
  let signal: AbortSignal | undefined;
  const releaseFetch = (response: Response) => {
    const resolve = resolveFetch;
    if (resolve) resolve(response);
  };
  globalThis.fetch = (async (_input, init) => {
    signal = init?.signal ?? undefined;
    return new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
  }) as typeof fetch;
  try {
    const http = new HttpTransport({ url: 'https://upstream.example.test/mcp' });
    const pending = http.request('tools/list');
    await Promise.resolve();
    await http.close();
    await assert.rejects(
      Promise.race([
        pending,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('close did not cancel request')), 100),
        ),
      ]),
      (error: UpstreamError) => error.code === 'UPSTREAM_DIED',
    );
    assert.equal(signal?.aborted, true);
    releaseFetch(new Response('{"jsonrpc":"2.0","id":1,"result":{}}'));
    await pending.catch(() => {});
  } finally {
    globalThis.fetch = originalFetch;
  }
});
