import assert from 'node:assert/strict';
import test from 'node:test';
import { catalogDiff } from '../src/fingerprint.js';
import { HttpTransport } from '../src/http-transport.js';
import { parseJsonRpcMessage, type UpstreamError } from '../src/protocol.js';
import { EventStreamParser, fetchSameOrigin, safeHttpUrl } from '../src/transport.js';

const URL_BASE = 'https://upstream.example.test/mcp';
const encoder = new TextEncoder();
type FakeFetch = (input: unknown, init?: RequestInit) => Promise<Response>;

async function withFetch(fake: FakeFetch, run: () => Promise<void>): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = fake as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = original;
  }
}

const stream = (text: string) =>
  new Response(text, { headers: { 'content-type': 'text/event-stream' } });
const code = (expected: string, message?: RegExp) => (error: UpstreamError) =>
  error.code === expected && (!message || message.test(error.message));

test('connect falls back to default identity fields when initialize returns an empty result', async () => {
  await withFetch(
    async (_input, init) => {
      const message = JSON.parse(String(init?.body)) as { id?: number };
      if (message.id === undefined) return new Response('', { status: 202 });
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: {} }));
    },
    async () => {
      const info = await new HttpTransport({ url: URL_BASE }).connect();
      assert.deepEqual(info, {
        name: 'unknown',
        version: '0.0.0',
        protocolVersion: '2025-06-18',
        capabilities: {},
      });
    },
  );
});

test('a request whose response body is blank is a protocol error', async () => {
  await withFetch(
    async () => new Response('   '),
    async () => {
      await assert.rejects(
        new HttpTransport({ url: URL_BASE }).request('tools/list'),
        code('UPSTREAM_PROTOCOL', /tools\/list returned no body/),
      );
    },
  );
});

test('a non-Error fetch failure reports an unknown cause', async () => {
  await withFetch(
    async () => {
      throw 'sample value';
    },
    async () => {
      await assert.rejects(new HttpTransport({ url: URL_BASE }).request('x'), (error: UpstreamError) => {
        assert.equal(error.code, 'UPSTREAM_CONNECT_FAILED');
        assert.deepEqual(error.details, { cause: 'unknown' });
        return true;
      });
    },
  );
});

test('a non-ok HTTP status is a connect failure naming the status', async () => {
  await withFetch(
    async () => new Response('nope', { status: 503 }),
    async () => {
      await assert.rejects(
        new HttpTransport({ url: URL_BASE }).request('x'),
        code('UPSTREAM_CONNECT_FAILED', /returned 503/),
      );
    },
  );
});

test('an event stream without a body is a protocol error', async () => {
  await withFetch(
    async () => new Response(null, { headers: { 'content-type': 'Text/Event-Stream' } }),
    async () => {
      await assert.rejects(
        new HttpTransport({ url: URL_BASE }).request('x'),
        code('UPSTREAM_PROTOCOL', /has no body/),
      );
    },
  );
});

test('an event stream ending before any response is a protocol error', async () => {
  await withFetch(
    async () => stream('event: ping\n\n'),
    async () => {
      await assert.rejects(
        new HttpTransport({ url: URL_BASE }).request('x'),
        code('UPSTREAM_PROTOCOL', /ended before the response/),
      );
    },
  );
});

test('an event stream carrying invalid JSON-RPC data is a protocol error', async () => {
  await withFetch(
    async () => stream('data: not json\n\n'),
    async () => {
      await assert.rejects(
        new HttpTransport({ url: URL_BASE }).request('x'),
        code('UPSTREAM_PROTOCOL', /invalid JSON-RPC message/),
      );
    },
  );
});

test('events after the matching response in one chunk are ignored, mismatched ids skipped', async () => {
  const frame = (id: number, value: string) =>
    `data: ${JSON.stringify({ jsonrpc: '2.0', id, result: { value } })}\n\n`;
  await withFetch(
    async () => stream(frame(99, 'other') + frame(1, 'first') + frame(1, 'second')),
    async () => {
      const http = new HttpTransport({ url: URL_BASE });
      assert.deepEqual(await http.request('x'), { value: 'first' });
    },
  );
});

test('a notification post answered by an event stream accepts any response id', async () => {
  let sawPost = false;
  await withFetch(
    async () => {
      sawPost = true;
      return stream(`data: ${JSON.stringify({ jsonrpc: '2.0', id: 7, result: {} })}\n\n`);
    },
    async () => {
      const http = new HttpTransport({ url: URL_BASE });
      const post = (http as unknown as { post(message: unknown): Promise<unknown> }).post.bind(http);
      assert.deepEqual(await post({ jsonrpc: '2.0', method: 'notifications/initialized' }), {
        jsonrpc: '2.0',
        id: 7,
        result: {},
      });
      assert.equal(sawPost, true);
    },
  );
});

test('notifications arriving before a handler is registered are dropped silently', async () => {
  const note = JSON.stringify({ jsonrpc: '2.0', method: 'notifications/progress' });
  const reply = JSON.stringify({ jsonrpc: '2.0', id: 1, result: { ok: true } });
  await withFetch(
    async () => stream(`data: ${note}\n\ndata: ${reply}\n\n`),
    async () => {
      assert.deepEqual(await new HttpTransport({ url: URL_BASE }).request('x'), { ok: true });
    },
  );
});

test('a stream read that fails after the deadline aborts reports a timeout', async () => {
  await withFetch(
    async (_input, init) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(': keepalive\n'));
          init?.signal?.addEventListener('abort', () => controller.error(new Error('aborted')));
        },
      });
      return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
    },
    async () => {
      await assert.rejects(
        new HttpTransport({ url: URL_BASE, deadlineMs: 20 }).request('x'),
        code('UPSTREAM_CONNECT_FAILED', /timed out/),
      );
    },
  );
});

test('a stream read error that is not an abort is rethrown unchanged', async () => {
  await withFetch(
    async () => {
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.error(new Error('sample value failure'));
        },
      });
      return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
    },
    async () => {
      await assert.rejects(new HttpTransport({ url: URL_BASE }).request('x'), /sample value failure/);
    },
  );
});

test('closing during an open event stream cancels the reader and rejects the request', async () => {
  let cancelled = false;
  let started!: () => void;
  const ready = new Promise<void>((resolve) => (started = resolve));
  await withFetch(
    async () => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(': open\n'));
          started();
        },
        cancel() {
          cancelled = true;
        },
      });
      return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
    },
    async () => {
      const http = new HttpTransport({ url: URL_BASE });
      const pending = http.request('x');
      await ready;
      await new Promise((resolve) => setImmediate(resolve));
      await http.close();
      await assert.rejects(pending, code('UPSTREAM_DIED'));
      assert.equal(cancelled, true);
    },
  );
});

test('safeHttpUrl rejects invalid, non-http and credential-bearing urls', () => {
  assert.throws(() => safeHttpUrl('not a url'), /URL is invalid/);
  assert.throws(() => safeHttpUrl('ftp://example.test/'), /must use http or https/);
  assert.throws(() => safeHttpUrl('https://someone@example.test/'), /Credentials/);
  assert.throws(() => new HttpTransport({ url: 'file:///tmp/x' }), /must use http or https/);
});

test('fetchSameOrigin follows same-origin redirects and refuses unsafe ones', async () => {
  const hops: string[] = [];
  const redirect = (location: string | null) =>
    new Response(null, { status: 302, headers: location ? { location } : {} });
  await withFetch(
    async (input) => {
      hops.push(String(input));
      return hops.length === 1 ? redirect('/next') : new Response('ok');
    },
    async () => {
      assert.equal(await (await fetchSameOrigin(URL_BASE, {})).text(), 'ok');
      assert.deepEqual(hops, [URL_BASE, 'https://upstream.example.test/next']);
    },
  );
  await withFetch(
    async () => redirect(null),
    async () => {
      await assert.rejects(fetchSameOrigin(URL_BASE, {}), /has no location/);
    },
  );
  await withFetch(
    async () => redirect('https://elsewhere.example.test/'),
    async () => {
      await assert.rejects(fetchSameOrigin(URL_BASE, {}), /another origin/);
    },
  );
  await withFetch(
    async () => redirect('/loop'),
    async () => {
      await assert.rejects(fetchSameOrigin(URL_BASE, {}, 1), /too many times/);
    },
  );
});

test('EventStreamParser flushes a trailing carriage return and splits lone CR lines', () => {
  const events: string[] = [];
  const parser = new EventStreamParser();
  parser.push('data: a\rdata: b\r\r', (event) => events.push(event));
  assert.equal(events.length, 0);
  parser.finish((event) => events.push(event));
  assert.deepEqual(events, ['data: a\ndata: b']);
});

test('parseJsonRpcMessage rejects non-objects, unsafe ids and array errors', () => {
  assert.equal(parseJsonRpcMessage('null'), null);
  assert.equal(parseJsonRpcMessage('3'), null);
  assert.equal(parseJsonRpcMessage('{"jsonrpc":"2.0","id":1.5,"result":{}}'), null);
  assert.equal(parseJsonRpcMessage('{"jsonrpc":"2.0","id":1,"error":[]}'), null);
  assert.equal(parseJsonRpcMessage('{"jsonrpc":"2.0","id":1,"error":null}'), null);
});

test('catalogDiff reports added, removed and changed entries across every group', () => {
  const previous = {
    tools: [
      { name: 'keep', inputSchema: { b: 1, a: [1, 2] } },
      { name: 'gone' },
      { name: 'edit', description: 'old' },
    ],
    resources: [{ uri: 'aevra://r/1', name: 'one' }],
    prompts: [{ name: 'p1' }],
  };
  const next = {
    tools: [
      { name: 'keep', inputSchema: { a: [1, 2], b: 1 } },
      { name: 'edit', description: 'new' },
      { name: 'fresh' },
    ],
    resources: [{ uri: 'aevra://r/1', name: 'renamed' }],
    prompts: [{ name: 'p2', description: 'second' }],
  };
  assert.deepEqual(catalogDiff(previous, next), {
    added: ['prompt:p2', 'tool:fresh'],
    removed: ['prompt:p1', 'tool:gone'],
    changed: ['resource:aevra://r/1', 'tool:edit'],
  });
  assert.deepEqual(catalogDiff(null, { tools: [{ name: 'a' }], resources: [], prompts: [] }), {
    added: ['tool:a'],
    removed: [],
    changed: [],
  });
});
