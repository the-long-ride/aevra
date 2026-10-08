import assert from 'node:assert/strict';
import http, { type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import {
  GATEWAY_TRUST_HEADER,
  ORIGINAL_TRANSPORT_HEADER,
  PublicGateway,
} from '../src/gateway/public-gateway.js';

const plainPhrase1 = 'sample words';

type Seen = { url?: string; headers: IncomingHttpHeaders };

async function upstream(
  t: any,
  reply: (res: http.ServerResponse, req: http.IncomingMessage) => void,
) {
  const seen: Seen[] = [];
  const server = http.createServer((req, res) => {
    seen.push({ url: req.url, headers: req.headers });
    req.resume();
    req.on('end', () => reply(res, req));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen };
}

async function gateway(t: any, options: Partial<ConstructorParameters<typeof PublicGateway>[0]>) {
  const subject = new PublicGateway({
    host: '127.0.0.1',
    port: 0,
    protocol: 'http',
    targets: { adminUrl: 'http://127.0.0.1:9', mcpUrl: 'http://127.0.0.1:9' },
    ...options,
  } as any);
  await subject.start();
  t.after(() => subject.close());
  return subject;
}

function send(url: string, headers: Record<string, string> = {}, method = 'GET') {
  return new Promise<{ status: number; headers: IncomingHttpHeaders; body: string }>(
    (resolve, reject) => {
      const req = http.request(url, { method, headers, agent: false }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      });
      req.on('error', reject);
      req.end();
    },
  );
}

test('https gateway without TLS options refuses to start; lifecycle calls are idempotent', async () => {
  const bare = new PublicGateway({
    host: '127.0.0.1',
    port: 0,
    targets: { adminUrl: 'x', mcpUrl: 'x' },
  });
  await assert.rejects(() => bare.start(), /requires TLS options/);
  assert.equal(bare.address(), undefined);
  assert.equal(bare.url(), 'https://127.0.0.1:0');
  await bare.close();
  const live = new PublicGateway({
    host: '127.0.0.1',
    port: 0,
    protocol: 'http',
    targets: { adminUrl: 'x', mcpUrl: 'x' },
  });
  await live.start();
  const port = (live.address() as AddressInfo).port;
  await live.start();
  assert.equal((live.address() as AddressInfo).port, port);
  assert.equal(live.url(), `http://127.0.0.1:${port}`);
  await live.close();
  assert.equal(live.address(), undefined);
});

test('admin paths get trust headers; connection-listed and forwarded headers are stripped', async (t) => {
  const admin = await upstream(t, (res) => {
    res.setHeader('connection', 'x-drop-me');
    res.setHeader('x-drop-me', 'gone');
    res.setHeader('x-keep', 'kept');
    res.end('admin body');
  });
  const subject = await gateway(t, {
    targets: { adminUrl: admin.url, mcpUrl: 'http://127.0.0.1:9' },
    gatewayTrustSecret: plainPhrase1,
    adminProxyEnabled: () => true,
  });
  const response = await send(`${subject.url()}/settings?tab=one`, {
    connection: 'x-private, , keep-alive',
    'x-private': 'hidden',
    'x-forwarded-for': '203.0.113.9',
    'x-real-ip': '203.0.113.9',
    [GATEWAY_TRUST_HEADER]: 'forged',
    'x-visible': 'shown',
  });
  assert.equal(response.status, 200);
  assert.equal(response.body, 'admin body');
  assert.equal(response.headers['x-keep'], 'kept');
  assert.equal(response.headers['x-drop-me'], undefined);
  const seen = admin.seen[0]!;
  assert.equal(seen.url, '/settings?tab=one');
  assert.equal(seen.headers['x-private'], undefined);
  assert.equal(seen.headers['x-forwarded-for'], undefined);
  assert.equal(seen.headers['x-real-ip'], undefined);
  assert.equal(seen.headers['x-visible'], 'shown');
  assert.equal(seen.headers[GATEWAY_TRUST_HEADER], 'sample words');
  assert.equal(seen.headers[ORIGINAL_TRANSPORT_HEADER], 'http');
});

test('mcp paths skip trust headers and keep client-ip hints when trusted', async (t) => {
  const mcp = await upstream(t, (res) => {
    res.statusCode = 201;
    res.end('mcp body');
  });
  const subject = await gateway(t, {
    targets: { adminUrl: 'http://127.0.0.1:9', mcpUrl: mcp.url },
    gatewayTrustSecret: plainPhrase1,
    trustForwardedClientIp: () => true,
  });
  for (const pathname of [
    '/mcp',
    '/mcp/x',
    '/health',
    '/oauth',
    '/oauth/token',
    '/.well-known',
    '/.well-known/x',
  ]) {
    const response = await send(`${subject.url()}${pathname}`, {
      'x-real-ip': '198.51.100.4',
      'x-forwarded-host': 'evil',
    });
    assert.equal(response.status, 201, pathname);
  }
  assert.equal(mcp.seen.length, 7);
  assert.equal(mcp.seen[0]!.headers['x-real-ip'], '198.51.100.4');
  assert.equal(mcp.seen[0]!.headers['x-forwarded-host'], undefined);
  assert.equal(mcp.seen[0]!.headers[GATEWAY_TRUST_HEADER], undefined);
});

test('admin paths are refused when the admin proxy is disabled', async (t) => {
  const subject = await gateway(t, { adminProxyEnabled: () => false });
  const response = await send(`${subject.url()}/login`);
  assert.equal(response.status, 404);
  assert.deepEqual(JSON.parse(response.body), {
    error: { code: 'NOT_FOUND', message: 'Not Found' },
  });
});

test('unreachable upstreams produce a 502 JSON error', async (t) => {
  const closed = http.createServer();
  await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
  const deadUrl = `http://127.0.0.1:${(closed.address() as AddressInfo).port}`;
  await new Promise<void>((resolve) => closed.close(() => resolve()));
  const subject = await gateway(t, { targets: { adminUrl: deadUrl, mcpUrl: deadUrl } });
  const response = await send(`${subject.url()}/mcp`, {}, 'POST');
  assert.equal(response.status, 502);
  assert.equal(JSON.parse(response.body).error.code, 'UPSTREAM_UNAVAILABLE');
});
