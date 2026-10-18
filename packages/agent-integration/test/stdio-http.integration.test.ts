import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { PassThrough } from 'node:stream';
import { httpTransport } from '../src/stdio-http.js';
import { runStdio } from '../src/stdio.js';

test('HTTP bridge preserves session headers and Unicode split between SSE chunks', async () => {
  const headers: Array<Record<string, unknown>> = [];
  const server = createServer(async (req, res) => {
    headers.push(req.headers);
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const input = JSON.parse(raw);
    if (input.method === 'initialize') {
      res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'test-session' });
      res.end(
        JSON.stringify({ jsonrpc: '2.0', id: input.id, result: { protocolVersion: '2025-03-26' } }),
      );
    } else {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const frame = Buffer.from(
        `data: ${JSON.stringify({ jsonrpc: '2.0', id: input.id, result: { text: 'Xin chào 🐈' } })}\n\n`,
      );
      const split = frame.indexOf(Buffer.from('🐈')) + 1;
      res.write(frame.subarray(0, split));
      setTimeout(() => res.end(frame.subarray(split)), 10);
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${(server.address() as any).port}/mcp`;
  const transport = httpTransport({ version: 1, id: 'c', token: 'secret', endpoint });
  const messages: any[] = [],
    controller = new AbortController();
  try {
    await transport.send(
      { jsonrpc: '2.0', id: 1, method: 'initialize' },
      async (message) => {
        messages.push(message);
      },
      controller.signal,
    );
    await transport.send(
      { jsonrpc: '2.0', id: 2, method: 'tools/call' },
      async (message) => {
        messages.push(message);
      },
      controller.signal,
    );
    assert.equal(headers[1]['mcp-session-id'], 'test-session');
    assert.equal(headers[1]['mcp-protocol-version'], '2025-03-26');
    assert.equal(headers[1].authorization, 'Bearer secret');
    assert.equal(messages[1].result.text, 'Xin chào 🐈');
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('an unavailable core emits a protocol error, diagnostic and nonzero exit', async () => {
  const stdin = new PassThrough(),
    stdout = new PassThrough(),
    stderr = new PassThrough();
  let out = '',
    err = '';
  stdout.on('data', (b) => {
    out += b;
  });
  stderr.on('data', (b) => {
    err += b;
  });
  const running = runStdio(
    { stdin, stdout, stderr },
    {
      async send() {
        throw new Error('MCP HTTP 401');
      },
    },
  );
  stdin.end('{"jsonrpc":"2.0","id":1,"method":"initialize"}\n');
  assert.equal(await running, 1);
  assert.equal(JSON.parse(out.trim()).error.code, -32000);
  assert.match(err, /MCP/);
});

test('bridge starts a new session with the client initialize when core forgets the old one', async () => {
  const sessions = new Set<string>();
  const seen: Array<{ method: string; session: unknown; params: unknown }> = [];
  let issued = 0;
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const input = JSON.parse(raw);
    const session = req.headers['mcp-session-id'];
    seen.push({ method: input.method, session, params: input.params });
    if (input.method === 'initialize') {
      const id = `session-${++issued}`;
      sessions.add(id);
      res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': id });
      res.end(
        JSON.stringify({ jsonrpc: '2.0', id: input.id, result: { protocolVersion: '2025-06-18' } }),
      );
      return;
    }
    if (!sessions.has(String(session))) {
      res.writeHead(404).end();
      return;
    }
    if (input.id === undefined) {
      res.writeHead(202).end();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: input.id, result: { from: session } }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${(server.address() as any).port}/mcp`;
  const transport = httpTransport({ version: 1, id: 'c', token: 'plain words', endpoint });
  const out: any[] = [];
  const emit = async (message: unknown) => {
    out.push(message);
  };
  const signal = new AbortController().signal;
  const clientInfo = { name: 'phrase client', version: '1' };
  try {
    await transport.send(
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo } },
      emit,
      signal,
    );
    await transport.send({ jsonrpc: '2.0', method: 'notifications/initialized' }, emit, signal);
    await transport.send({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, emit, signal);
    sessions.clear();
    await transport.send({ jsonrpc: '2.0', id: 3, method: 'tools/list' }, emit, signal);
    assert.deepEqual(
      out.map((message) => message.id),
      [1, 2, 3],
    );
    assert.equal(out[2].result.from, 'session-2');
    const second = seen.filter((entry) => entry.method === 'initialize')[1];
    assert.deepEqual(second?.params, { clientInfo });
    assert.equal(second?.session, undefined);
    assert.ok(
      seen.some(
        (entry) => entry.method === 'notifications/initialized' && entry.session === 'session-2',
      ),
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('a failed reopen keeps the stale session, so the next request reopens again', async () => {
  const sessions = new Set<string>();
  let issued = 0,
    failInitialize = 0;
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const input = JSON.parse(raw);
    const session = req.headers['mcp-session-id'];
    if (input.method === 'initialize') {
      if (failInitialize-- > 0) {
        res.writeHead(500).end();
        return;
      }
      const id = `session-${++issued}`;
      sessions.add(id);
      res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': id });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: input.id, result: {} }));
      return;
    }
    // As core: no session id is a 400 (never retried); an unknown one is a 404.
    if (session === undefined) {
      res.writeHead(400).end();
      return;
    }
    if (!sessions.has(String(session))) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: input.id, result: { from: session } }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${(server.address() as any).port}/mcp`;
  const transport = httpTransport({ version: 1, id: 'c', token: 'plain words', endpoint });
  const out: any[] = [];
  const emit = async (message: unknown) => {
    out.push(message);
  };
  const signal = new AbortController().signal;
  try {
    await transport.send({ jsonrpc: '2.0', id: 1, method: 'initialize' }, emit, signal);
    sessions.clear();
    failInitialize = 1;
    await assert.rejects(
      transport.send({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, emit, signal),
      /MCP HTTP 500/,
    );
    await transport.send({ jsonrpc: '2.0', id: 3, method: 'tools/list' }, emit, signal);
    assert.equal(out.at(-1).result.from, 'session-2');
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
