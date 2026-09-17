import assert from 'node:assert/strict';
import test from 'node:test';
import { SseTransport } from '../src/sse-transport.js';
import type { UpstreamError } from '../src/protocol.js';
import { startFakeMcpServer } from './fake-http-server.js';

test('connect opens the stream, learns the POST endpoint, and handshakes', async () => {
  const server = await startFakeMcpServer();
  const sse = new SseTransport({ url: server.sseUrl });
  try {
    const info = await sse.connect();
    assert.equal(info.name, 'fake-http');
    assert.equal(info.protocolVersion, '2025-06-18');
  } finally {
    await sse.close();
    await server.close();
  }
});

test('a reply that arrives on the event stream resolves the matching call', async () => {
  const server = await startFakeMcpServer();
  const sse = new SseTransport({ url: server.sseUrl });
  try {
    await sse.connect();
    const result = (await sse.request('tools/list')) as { tools: Array<{ name: string }> };
    assert.deepEqual(
      result.tools.map((tool) => tool.name),
      ['lookup'],
    );
  } finally {
    await sse.close();
    await server.close();
  }
});

test('the configured auth header is sent on the stream and on each POST', async () => {
  const server = await startFakeMcpServer();
  const sse = new SseTransport({ url: server.sseUrl, headers: { Authorization: 'Bearer t-1' } });
  try {
    await sse.connect();
    await sse.request('tools/list');
    assert.ok(server.requests.length >= 2);
    for (const request of server.requests)
      assert.equal(request.headers.authorization, 'Bearer t-1');
  } finally {
    await sse.close();
    await server.close();
  }
});

test('closing rejects calls still in flight as UPSTREAM_DIED', async () => {
  const server = await startFakeMcpServer();
  const sse = new SseTransport({ url: server.sseUrl, deadlineMs: 5000 });
  await sse.connect();
  const inFlight = sse.request('never/answered');
  const rejection = inFlight.then(
    () => assert.fail('the in-flight request unexpectedly resolved'),
    (error: UpstreamError) => {
      assert.equal(error.code, 'UPSTREAM_DIED');
    },
  );
  await sse.close();
  await rejection;
  await server.close();
});

test('an unreachable stream fails the connect rather than hanging', async () => {
  const sse = new SseTransport({ url: 'http://127.0.0.1:1/sse', deadlineMs: 500 });
  await assert.rejects(sse.connect(), (error: UpstreamError) => {
    assert.equal(error.code, 'UPSTREAM_CONNECT_FAILED');
    return true;
  });
});

test('a stream whose response headers never arrive respects the connection deadline', async () => {
  const originalFetch = globalThis.fetch;
  let transport: SseTransport | null = null;
  globalThis.fetch = (async (_input, init) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    })) as typeof fetch;
  try {
    transport = new SseTransport({ url: 'https://upstream.example.test/sse', deadlineMs: 20 });
    const pending = transport.connect();
    await assert.rejects(
      Promise.race([
        pending,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('connection deadline was not enforced')), 100),
        ),
      ]),
      (error: UpstreamError) => error.code === 'UPSTREAM_CONNECT_FAILED',
    );
    await pending.catch(() => {});
  } finally {
    await transport?.close();
    globalThis.fetch = originalFetch;
  }
});

test('CRLF endpoint events complete the SSE handshake', async () => {
  const originalFetch = globalThis.fetch;
  const encoder = new TextEncoder();
  let stream: ReadableStreamDefaultController<Uint8Array> | null = null;
  let postUrl: string | null = null;
  globalThis.fetch = (async (_input, init) => {
    if (init?.method === 'GET') {
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            stream = controller;
            controller.enqueue(encoder.encode('event: endpoint\r\ndata: /post\r\n\r\n'));
          },
        }),
        { headers: { 'content-type': 'text/event-stream' } },
      );
    }
    postUrl = String(_input);
    const request = JSON.parse(String(init?.body)) as { id?: number };
    stream?.enqueue(
      encoder.encode(
        `event: message\r\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { ok: true } })}\r\n\r\n`,
      ),
    );
    return new Response(null, { status: 202 });
  }) as typeof fetch;
  try {
    const sse = new SseTransport({ url: 'https://upstream.example.test/sse', deadlineMs: 100 });
    assert.deepEqual(await sse.connect(), {
      name: 'unknown',
      version: '0.0.0',
      protocolVersion: '2025-06-18',
      capabilities: {},
    });
    await sse.close();
    assert.equal(postUrl, 'https://upstream.example.test/post');
  } finally {
    stream?.close();
    globalThis.fetch = originalFetch;
  }
});

test('an idle SSE disconnect rejects new requests immediately', async () => {
  const originalFetch = globalThis.fetch;
  const encoder = new TextEncoder();
  let stream: ReadableStreamDefaultController<Uint8Array> | null = null;
  globalThis.fetch = (async (_input, init) => {
    if (init?.method === 'GET')
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            stream = controller;
            controller.enqueue(encoder.encode('event: endpoint\ndata: /post\n\n'));
          },
        }),
        { headers: { 'content-type': 'text/event-stream' } },
      );
    const request = JSON.parse(String(init?.body)) as { id?: number };
    stream?.enqueue(
      encoder.encode(
        `data: ${JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { ok: true } })}\n\n`,
      ),
    );
    return new Response(null, { status: 202 });
  }) as typeof fetch;
  try {
    const sse = new SseTransport({ url: 'https://upstream.example.test/sse', deadlineMs: 20 });
    await sse.connect();
    stream?.close();
    stream = null;
    await new Promise((resolve) => setImmediate(resolve));
    await assert.rejects(sse.request('tools/list'), (error: UpstreamError) => {
      assert.equal(error.code, 'UPSTREAM_DIED');
      return true;
    });
    await sse.close();
  } finally {
    stream?.close();
    globalThis.fetch = originalFetch;
  }
});

test('an advertised endpoint must stay on the configured origin', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response('event: endpoint\ndata: https://collector.example.test/post\n\n', {
      headers: { 'content-type': 'text/event-stream' },
    })) as typeof fetch;
  try {
    const sse = new SseTransport({
      url: 'https://upstream.example.test/sse',
      headers: { Authorization: 'Bearer credential' },
      deadlineMs: 100,
    });
    await assert.rejects(sse.connect(), (error: UpstreamError) => {
      assert.equal(error.code, 'UPSTREAM_CONNECT_FAILED');
      assert.match(error.message, /another origin/);
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

for (const terminal of ['close', 'stream-end']) {
  test(`SSE ${terminal} cancels a stalled POST promptly`, async () => {
    const original = globalThis.fetch;
    const encoder = new TextEncoder();
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    let release!: (response: Response) => void;
    let posted!: () => void;
    let signal: AbortSignal | null | undefined;
    const started = new Promise<void>((resolve) => {
      posted = resolve;
    });
    globalThis.fetch = async (_url, init) => {
      if (init?.method === 'GET')
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              stream = controller;
              stream.enqueue(encoder.encode('event: endpoint\ndata: /messages\n\n'));
            },
          }),
        );
      const message = JSON.parse(String(init?.body));
      if (message.method === 'initialize') {
        stream.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { capabilities: {} } })}\n\n`,
          ),
        );
        return new Response(null, { status: 202 });
      }
      if (message.method === 'notifications/initialized')
        return new Response(null, { status: 202 });
      if (release) {
        stream.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { ok: true } })}\n\n`,
          ),
        );
        return new Response(null, { status: 202 });
      }
      signal = init?.signal;
      posted();
      return new Promise<Response>((resolve) => {
        release = resolve;
      });
    };
    const transport = new SseTransport({ url: 'http://localhost/events', deadlineMs: 1000 });
    let pending: Promise<unknown> | undefined;
    try {
      await transport.connect();
      pending = transport.request('tools/call');
      pending.catch(() => {});
      await started;
      if (terminal === 'close') await transport.close();
      else stream.close();
      await assert.rejects(
        Promise.race([
          pending,
          new Promise((_, reject) => setTimeout(() => reject(new Error('not cancelled')), 100)),
        ]),
        (error: UpstreamError) => error.code === 'UPSTREAM_DIED',
      );
      assert.equal(signal?.aborted, true);
      if (terminal === 'close') stream.close();
      await transport.connect();
      release(new Response(null, { status: 500 }));
      assert.deepEqual(await transport.request('tools/call'), { ok: true });
    } finally {
      release?.(new Response(null, { status: 202 }));
      await pending?.catch(() => {});
      await transport.close();
      stream?.close();
      globalThis.fetch = original;
    }
  });
}

test('an idle connected stream remains usable after the startup deadline', async () => {
  const server = await startFakeMcpServer();
  const sse = new SseTransport({ url: server.sseUrl, deadlineMs: 40 });
  try {
    await sse.connect();
    await new Promise((resolve) => setTimeout(resolve, 80));
    const result = (await sse.request('tools/list')) as { tools: Array<{ name: string }> };
    assert.deepEqual(
      result.tools.map((tool) => tool.name),
      ['lookup'],
    );
  } finally {
    await sse.close();
    await server.close();
  }
});
